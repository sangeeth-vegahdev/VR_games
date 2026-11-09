import { defineAssets } from '@iwsdk/core';

// Everything in Bulb Rush is built from code (no models to download), so the cold start is tiny.
// The two hand models in public/models are loaded by the SDK's hand visuals (see src/hands.js).
export default defineAssets({});
