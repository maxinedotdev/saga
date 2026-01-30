/**
 * Language detection utility using efficient-language-detector (eld)
 * Provides ISO 639-1 normalized language codes with confidence threshold filtering
 */

import eld from 'eld';

// ISO 639-1 code normalization map for common language codes
// eld returns ISO 639-1 codes directly, but we handle edge cases
const ISO_639_1_NORMALIZATION: Record<string, string> = {
    // eld already returns ISO 639-1, but we can add overrides if needed
    'zh': 'zh',
    'zh-cn': 'zh',
    'zh-tw': 'zh',
    'en': 'en',
    'es': 'es',
    'fr': 'fr',
    'de': 'de',
    'it': 'it',
    'ja': 'ja',
    'ko': 'ko',
    'pt': 'pt',
    'ru': 'ru',
    'ar': 'ar',
    'hi': 'hi',
    'nl': 'nl',
    'pl': 'pl',
    'tr': 'tr',
    'vi': 'vi',
    'id': 'id',
    'th': 'th',
    'sv': 'sv',
    'cs': 'cs',
    'el': 'el',
    'he': 'he',
    'fi': 'fi',
    'no': 'no',
    'da': 'da',
    'uk': 'uk',
    'ro': 'ro',
    'hu': 'hu',
};

/**
 * Detect languages in text content
 * @param text The text to analyze
 * @param confidenceThreshold Minimum confidence score (0-1) for a language to be included
 * @returns Array of ISO 639-1 language codes, or ['unknown'] if detection fails
 */
export function detectLanguages(text: string, confidenceThreshold = 0.2): string[] {
    if (!text || text.trim().length === 0) {
        return ['unknown'];
    }

    try {
        // eld.detect returns { language: string, score: number }
        const result = eld.detect(text);

        if (!result || !result.language) {
            return ['unknown'];
        }

        // Check if confidence meets threshold
        const score = result.score || 0;
        if (score < confidenceThreshold) {
            return ['unknown'];
        }

        // Normalize to ISO 639-1
        const normalizedCode = normalizeLanguageCode(result.language);
        return [normalizedCode];
    } catch (error) {
        console.error('[LanguageDetection] Detection failed:', error);
        return ['unknown'];
    }
}

/**
 * Normalize a language code to ISO 639-1
 * @param code The language code to normalize
 * @returns Normalized ISO 639-1 code or 'unknown'
 */
function normalizeLanguageCode(code: string): string {
    if (!code) {
        return 'unknown';
    }

    const lowerCode = code.toLowerCase().trim();

    // Check normalization map
    if (ISO_639_1_NORMALIZATION[lowerCode]) {
        return ISO_639_1_NORMALIZATION[lowerCode];
    }

    // ISO 639-1 codes are exactly 2 letters
    if (lowerCode.length === 2 && /^[a-z]{2}$/.test(lowerCode)) {
        return lowerCode;
    }

    // For 3-letter codes or other formats, return as-is if it looks valid
    if (lowerCode.length >= 2 && lowerCode.length <= 3 && /^[a-z]+$/.test(lowerCode)) {
        return lowerCode;
    }

    return 'unknown';
}

/**
 * Parse comma-separated language list from environment variable
 * @param envValue The environment variable value
 * @returns Array of language codes or null if not set
 */
export function parseLanguageList(envValue: string | undefined): string[] | null {
    if (!envValue || envValue.trim().length === 0) {
        return null;
    }

    return envValue
        .split(',')
        .map(code => code.trim().toLowerCase())
        .filter(code => code.length > 0);
}

/**
 * Get accepted languages from environment (MCP_ACCEPTED_LANGUAGES)
 * @returns Array of accepted language codes or null if not configured
 */
export function getAcceptedLanguages(): string[] | null {
    return parseLanguageList(process.env.MCP_ACCEPTED_LANGUAGES);
}

/**
 * Get default query languages from environment (MCP_DEFAULT_QUERY_LANGUAGES)
 * Falls back to MCP_ACCEPTED_LANGUAGES if not set
 * @returns Array of default query language codes or null if not configured
 */
export function getDefaultQueryLanguages(): string[] | null {
    const queryLangs = parseLanguageList(process.env.MCP_DEFAULT_QUERY_LANGUAGES);
    if (queryLangs) {
        return queryLangs;
    }
    // Fall back to accepted languages
    return getAcceptedLanguages();
}

/**
 * Get language confidence threshold from environment (MCP_LANGUAGE_CONFIDENCE_THRESHOLD)
 * @returns Confidence threshold value (default: 0.2)
 */
export function getLanguageConfidenceThreshold(): number {
    const raw = process.env.MCP_LANGUAGE_CONFIDENCE_THRESHOLD;
    if (!raw) {
        return 0.2;
    }

    const parsed = parseFloat(raw);
    if (isNaN(parsed) || parsed < 0 || parsed > 1) {
        console.warn(`[LanguageDetection] Invalid MCP_LANGUAGE_CONFIDENCE_THRESHOLD: ${raw}, using default 0.2`);
        return 0.2;
    }

    return parsed;
}

/**
 * Check if detected languages intersect with the allowed list
 * @param detectedLanguages Array of detected language codes
 * @param allowedLanguages Array of allowed language codes (or null to allow all)
 * @returns true if at least one detected language is in the allowed list (or if no allowlist)
 */
export function isLanguageAllowed(
    detectedLanguages: string[],
    allowedLanguages: string[] | null
): boolean {
    // If no allowlist is configured, allow all
    if (!allowedLanguages || allowedLanguages.length === 0) {
        return true;
    }

    // If detection returned unknown, check if unknown is in allowlist
    if (detectedLanguages.includes('unknown')) {
        return allowedLanguages.includes('unknown');
    }

    // Check if any detected language is in the allowlist
    return detectedLanguages.some(lang => allowedLanguages.includes(lang));
}

/**
 * Filter documents by language (for query-time filtering)
 * @param documentLanguages Array of languages for a document
 * @param filterLanguages Array of languages to filter by (or null/empty to skip filtering)
 * @returns true if document passes the filter
 */
export function matchesLanguageFilter(
    documentLanguages: string[] | undefined,
    filterLanguages: string[] | undefined
): boolean {
    // If no filter specified, allow all
    if (!filterLanguages || filterLanguages.length === 0) {
        return true;
    }

    // If document has no languages, only allow if 'unknown' is in filter
    if (!documentLanguages || documentLanguages.length === 0) {
        return filterLanguages.includes('unknown');
    }

    // Check if any document language matches the filter
    return documentLanguages.some(lang =>
        filterLanguages.includes(lang) ||
        (lang === 'unknown' && filterLanguages.includes('unknown'))
    );
}
