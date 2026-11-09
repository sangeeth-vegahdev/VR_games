import { createComponent, Types } from '@iwsdk/core';

// Declared in a system-free module (the editor imports it); the game reads them through queries.
export const Bulb = createComponent('Bulb', {
  index: { type: Types.Int32, default: 0 },
});

export const UiButton = createComponent('UiButton', {
  action: { type: Types.String, default: '' },
});
