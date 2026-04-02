'use strict';
const config = require('../../config');
const logger = require('../utils/logger');

/**
 * Thin client for the Ollama local LLM API.
 * Uses Node 18+ built-in fetch. Falls back gracefully if Ollama is not running.
 */
class OllamaClient {
  constructor() {
    this.host    = config.llm.host;
    this.model   = config.llm.model;
    this.timeout = config.llm.timeoutMs;
    this.available = null; // null = not yet checked
  }

  /**
   * Check whether Ollama is reachable. Caches the result for 60 seconds.
   */
  async isAvailable() {
    // If we checked recently, return the cached result
    if (this.available !== null && Date.now() - this._lastCheck < 60000) {
      return this.available;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.host}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      this.available = res.ok;
    } catch {
      this.available = false;
    }
    this._lastCheck = Date.now();
    if (!this.available) {
      logger.warn('Ollama not reachable — using rule-based fallback');
    }
    return this.available;
  }

  /**
   * Send a prompt to Ollama and return the response text.
   * @param {string} prompt - The full prompt to send
   * @param {object} [options] - Optional overrides (model, temperature, etc.)
   * @returns {Promise<string|null>} The model's response, or null on failure.
   */
  async generate(prompt, options = {}) {
    if (!config.llm.enabled) return null;
    if (!(await this.isAvailable())) return null;

    const body = {
      model:  options.model       ?? this.model,
      prompt,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens   ?? 150,
        top_p:       0.9,
      },
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      const res = await fetch(`${this.host}/api/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        logger.warn(`Ollama HTTP error: ${res.status}`);
        return null;
      }

      const data = await res.json();
      const text = (data.response || '').trim();
      logger.llm(`[${this.model}] → ${text.slice(0, 120)}`);
      return text || null;

    } catch (err) {
      if (err.name === 'AbortError') {
        logger.warn('Ollama request timed out');
      } else {
        logger.warn(`Ollama error: ${err.message}`);
        // Mark unavailable briefly so we stop hammering it
        this.available = false;
        this._lastCheck = Date.now();
      }
      return null;
    }
  }

  /**
   * Send a chat-style request (array of messages).
   * @param {Array<{role:string, content:string}>} messages
   * @param {object} [options]
   * @returns {Promise<string|null>}
   */
  async chat(messages, options = {}) {
    if (!config.llm.enabled) return null;
    if (!(await this.isAvailable())) return null;

    const body = {
      model:    options.model ?? this.model,
      messages,
      stream:   false,
      options: {
        temperature: options.temperature ?? 0.8,
        num_predict: options.maxTokens   ?? 150,
      },
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      const res = await fetch(`${this.host}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) return null;
      const data = await res.json();
      const text = (data.message?.content || '').trim();
      logger.llm(`[chat] → ${text.slice(0, 120)}`);
      return text || null;

    } catch (err) {
      if (err.name !== 'AbortError') logger.warn(`Ollama chat error: ${err.message}`);
      return null;
    }
  }
}

// Singleton instance
module.exports = new OllamaClient();
