import achora from "./achora.config.js";

/**
 * Central registry of all brand configs, keyed by brand ID.
 * To add a new brand: import its config and add it to this object.
 * No changes to webhooks or services are needed.
 *
 * @type {Record<string, object>}
 */
const brands = {
  [achora.id]: achora,
};

/**
 * Returns the brand config for a given brand ID.
 * Used by webhook handlers to resolve the brand from the :brandId URL param.
 *
 * @param {string} id - The brandId from the URL (e.g. "achora")
 * @returns {object|null} The brand config, or null if not found
 */
export const getBrandById = (id) => brands[id] ?? null;
