import { describe, expect, it } from "vitest";
import { parseGeoJsonLineString } from "../src/state-estimation/repository.js";

describe("parseGeoJsonLineString", () => {
  it("parses a GeoJSON LineString's [lon, lat] pairs into LatLng points", () => {
    const geojson = JSON.stringify({
      type: "LineString",
      coordinates: [
        [77.5946, 12.9716],
        [77.6, 12.98],
      ],
    });

    expect(parseGeoJsonLineString(geojson)).toEqual([
      { lat: 12.9716, lon: 77.5946 },
      { lat: 12.98, lon: 77.6 },
    ]);
  });

  it("rejects a non-LineString geometry", () => {
    const geojson = JSON.stringify({ type: "Point", coordinates: [77.5946, 12.9716] });
    expect(() => parseGeoJsonLineString(geojson)).toThrow(/LineString/);
  });
});
