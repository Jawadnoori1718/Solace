/**
 * Solace — distance between households.
 *
 * Used by the allocation engine's proximity constraint. The constraint is not
 * decorative: energy delivered locally puts less strain on the distribution
 * network, and a councillor can defend a neighbourhood-level match in a way
 * they cannot defend sending a Leeds household's surplus to Cornwall.
 */

const EARTH_RADIUS_KM = 6371;

const rad = (degrees: number): number => (degrees * Math.PI) / 180;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Great-circle distance between two points, in kilometres.
 *
 * The haversine formula. Treating the Earth as a sphere is wrong by a fraction
 * of a percent, which is irrelevant at the scale of one city and far smaller
 * than the arbitrariness of the eight-kilometre radius itself.
 */
export function distanceKm(from: Coordinates, to: Coordinates): number {
  const deltaLat = rad(to.latitude - from.latitude);
  const deltaLon = rad(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(rad(from.latitude)) *
      Math.cos(rad(to.latitude)) *
      Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
