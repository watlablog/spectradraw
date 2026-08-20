export interface RangeValues {
  minimum: number;
  maximum: number;
}

interface DualRangeElements {
  minimumRange: HTMLInputElement;
  maximumRange: HTMLInputElement;
  selection: HTMLElement;
}

interface DualRangeOptions {
  domainMinimum: number;
  domainMaximum: number;
  minimumGap: number;
  orientation?: 'horizontal' | 'vertical';
  onChange?: (values: RangeValues) => void;
}

export interface DualRangeController {
  getValues(): RangeValues;
  setBounds(
    minimum: number,
    maximum: number,
    selectedMinimum?: number,
    selectedMaximum?: number,
  ): void;
  setDisabled(disabled: boolean): void;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function bindDualRange(
  elements: DualRangeElements,
  options: DualRangeOptions,
): DualRangeController {
  let domainMinimum = options.domainMinimum;
  let domainMaximum = options.domainMaximum;
  let values: RangeValues = {
    minimum: domainMinimum,
    maximum: domainMaximum,
  };

  const gap = (): number => Math.min(
    options.minimumGap,
    domainMaximum - domainMinimum,
  );

  const render = (): void => {
    elements.minimumRange.min = String(domainMinimum);
    elements.minimumRange.max = String(domainMaximum);
    elements.maximumRange.min = String(domainMinimum);
    elements.maximumRange.max = String(domainMaximum);
    elements.minimumRange.value = String(values.minimum);
    elements.maximumRange.value = String(values.maximum);

    const span = domainMaximum - domainMinimum;
    const minimumPercent = ((values.minimum - domainMinimum) / span) * 100;
    const maximumPercent = ((values.maximum - domainMinimum) / span) * 100;
    if (options.orientation === 'vertical') {
      elements.selection.style.bottom = `${minimumPercent}%`;
      elements.selection.style.height = `${maximumPercent - minimumPercent}%`;
    } else {
      elements.selection.style.left = `${minimumPercent}%`;
      elements.selection.style.width = `${maximumPercent - minimumPercent}%`;
    }
  };

  const commitMinimum = (requested: number): void => {
    values.minimum = clamp(requested, domainMinimum, values.maximum - gap());
    render();
    options.onChange?.({ ...values });
  };

  const commitMaximum = (requested: number): void => {
    values.maximum = clamp(requested, values.minimum + gap(), domainMaximum);
    render();
    options.onChange?.({ ...values });
  };

  elements.minimumRange.addEventListener('input', () => {
    commitMinimum(elements.minimumRange.valueAsNumber);
  });
  elements.maximumRange.addEventListener('input', () => {
    commitMaximum(elements.maximumRange.valueAsNumber);
  });

  render();

  return {
    getValues(): RangeValues {
      return { ...values };
    },
    setBounds(
      minimum: number,
      maximum: number,
      selectedMinimum = minimum,
      selectedMaximum = maximum,
    ): void {
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) {
        throw new Error('View slider bounds must be finite and increasing.');
      }
      domainMinimum = minimum;
      domainMaximum = maximum;
      const maximumSelection = clamp(selectedMaximum, minimum + gap(), maximum);
      const minimumSelection = clamp(selectedMinimum, minimum, maximumSelection - gap());
      values = {
        minimum: minimumSelection,
        maximum: maximumSelection,
      };
      render();
    },
    setDisabled(disabled: boolean): void {
      elements.minimumRange.disabled = disabled;
      elements.maximumRange.disabled = disabled;
    },
  };
}
