import { describe, expect, it } from 'vitest';

import { bindDualRange } from '../src/ui/dualRange';

function fakeInput(): HTMLInputElement {
  return {
    min: '',
    max: '',
    value: '',
    valueAsNumber: 0,
    disabled: false,
    addEventListener() {},
  } as unknown as HTMLInputElement;
}

describe('dual range view bounds', () => {
  it('keeps the -80 to 0 dB domain while selecting -20 to 0 dB', () => {
    const minimumRange = fakeInput();
    const maximumRange = fakeInput();
    const selection = { style: {} } as HTMLElement;
    const controller = bindDualRange({
      minimumRange,
      maximumRange,
      selection,
    }, {
      domainMinimum: -80,
      domainMaximum: 0,
      minimumGap: 1,
      orientation: 'vertical',
    });

    controller.setBounds(-80, 0, -20, 0);

    expect(controller.getValues()).toEqual({ minimum: -20, maximum: 0 });
    expect(minimumRange.min).toBe('-80');
    expect(minimumRange.max).toBe('0');
    expect(minimumRange.value).toBe('-20');
    expect(maximumRange.value).toBe('0');
    expect(selection.style.bottom).toBe('75%');
    expect(selection.style.height).toBe('25%');
  });
});
