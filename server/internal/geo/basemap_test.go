package geo

import "testing"

func TestParseGeoJSON(t *testing.T) {
	b := []byte(`{"type":"FeatureCollection","features":[
	 {"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[-90.0,41.5],[-82.4,41.7],[-82.4,46.0],[-90.0,46.0],[-90.0,41.5]],[[-87,43],[-86,43],[-86,44],[-87,43]]]}},
	 {"type":"Feature","properties":{},"geometry":{"type":"MultiPolygon","coordinates":[[[[1,1],[2,1],[2,2],[1,1]]],[[[5,5],[6,5],[6,6],[5,5]]]]}},
	 {"type":"Feature","properties":{},"geometry":{"type":"MultiLineString","coordinates":[[[-84.8,41.7],[-84.8,41.7],[-84.4,41.7]],[[0,0],[1,1]]]}},
	 {"type":"Feature","properties":{},"geometry":null}]}`)
	polys, lines, err := ParseGeoJSON(b)
	if err != nil {
		t.Fatal(err)
	}
	if len(polys) != 3 || len(polys[0]) != 2 || polys[0][0][0] != -9000 || polys[0][0][1] != 4150 {
		t.Fatalf("polys: %v", polys)
	}
	if len(lines) != 2 || len(lines[0]) != 4 { // duplicate point dropped
		t.Fatalf("lines: %v", lines)
	}
}
