import { beforeAll } from 'vitest';
import 'dotenv/config';
import eld from 'eld';

// Initialize eld language detector model before all tests run
// This loads the ngrams database required for language detection
beforeAll(async () => {
    // eld is initialized automatically when imported
    // No need to call load() explicitly
});
