// adapted from: https://github.com/color-js/color.js/blob/main/src/spaces/oklch.js
type Vector3 = [number, number, number];

const multiplyMatrices = (A: number[], B: Vector3): Vector3 => {
  return [
    A[0] * B[0] + A[1] * B[1] + A[2] * B[2],
    A[3] * B[0] + A[4] * B[1] + A[5] * B[2],
    A[6] * B[0] + A[7] * B[1] + A[8] * B[2]
  ];
};

const oklch2oklab = ([l, c, h]: Vector3): Vector3 => [
  l,
  isNaN(h) ? 0 : c * Math.cos((h * Math.PI) / 180),
  isNaN(h) ? 0 : c * Math.sin((h * Math.PI) / 180)
];

const srgbLinear2rgb = (rgb: Vector3): Vector3 =>
  rgb.map(c =>
    Math.abs(c) > 0.0031308
      ? (c < 0 ? -1 : 1) * (1.055 * Math.pow(Math.abs(c), 1 / 2.4) - 0.055)
      : 12.92 * c
  ) as Vector3;

const oklab2xyz = (lab: Vector3): Vector3 => {
  const LMSg = multiplyMatrices(
    [
      1, 0.3963377773761749, 0.2158037573099136, 1, -0.1055613458156586,
      -0.0638541728258133, 1, -0.0894841775298119, -1.2914855480194092
    ],
    lab
  );
  const LMS = LMSg.map(val => val ** 3) as Vector3;
  return multiplyMatrices(
    [
      1.2268798758459243, -0.5578149944602171, 0.2813910456659647, -0.0405757452148008,
      1.112286803280317, -0.0717110580655164, -0.0763729366746601, -0.4214933324022432,
      1.5869240198367816
    ],
    LMS
  );
};

const xyz2rgbLinear = (xyz: Vector3): Vector3 => {
  return multiplyMatrices(
    [
      3.2409699419045226, -1.537383177570094, -0.4986107602930034, -0.9692436362808796,
      1.8759675015077202, 0.04155505740717559, 0.05563007969699366,
      -0.20397695888897652, 1.0569715142428786
    ],
    xyz
  );
};

export const oklch2rgb = (lch: Vector3): Vector3 =>
  srgbLinear2rgb(xyz2rgbLinear(oklab2xyz(oklch2oklab(lch))));

export function oklchToDeckGLColor(
  l: number,
  c: number,
  h: number,
  a: number = 255
): [number, number, number, number] {
  const rgb = oklch2rgb([l, c, h]);
  return [
    Math.max(0, Math.min(255, Math.round(rgb[0] * 255))),
    Math.max(0, Math.min(255, Math.round(rgb[1] * 255))),
    Math.max(0, Math.min(255, Math.round(rgb[2] * 255))),
    a
  ];
}
