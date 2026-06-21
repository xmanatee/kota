const MODEL = {
  intercept: 7.5,
  xCoefficient: 1.7,
  yCoefficient: -0.9,
};

export function predict(row) {
  return MODEL.intercept + MODEL.xCoefficient * row.x + MODEL.yCoefficient * row.y;
}
