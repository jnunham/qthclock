package main

import (
	"encoding/json"
	"os"
	"strings"
)

type Config struct {
	Listen   string `json:"listen"`
	Callsign string `json:"callsign"`
	Grid     string `json:"grid"`
	WebDir   string `json:"webDir"`
	DataDir  string `json:"dataDir"`

	// MapStyle is a MapLibre style URL. The default is a free dark basemap.
	MapStyle string `json:"mapStyle"`

	HistoryMinutes int `json:"historyMinutes"`
	HistoryMax     int `json:"historyMax"`

	PSKReporter struct {
		Enabled bool     `json:"enabled"`
		Addr    string   `json:"addr"`
		Topics  []string `json:"topics"`
	} `json:"pskreporter"`

	RBN struct {
		Enabled bool     `json:"enabled"`
		Addrs   []string `json:"addrs"`
	} `json:"rbn"`

	Cluster struct {
		Enabled bool   `json:"enabled"`
		Addr    string `json:"addr"`
	} `json:"cluster"`

	// WSJTX receives decodes from WSJT-X/JTDX on your PC: your own receiver as a spot source.
	WSJTX struct {
		Enabled bool   `json:"enabled"`
		Listen  string `json:"listen"`
	} `json:"wsjtx"`

	// NearKm: RBN/cluster spots only show if the spotter is this close to your QTH,
	// so the DX list is stations you can likely hear and work from home.
	NearKm float64 `json:"nearKm"`

	Solar struct {
		Enabled         bool `json:"enabled"`
		IntervalMinutes int  `json:"intervalMinutes"`
	} `json:"solar"`

	CTY struct {
		URL string `json:"url"`
	} `json:"cty"`

	Demo struct {
		Enabled bool `json:"enabled"`
		Rate    int  `json:"rate"`
	} `json:"demo"`
}

func defaultConfig() Config {
	var c Config
	c.Listen = ":8073"
	c.WebDir = "web"
	c.DataDir = "data"
	c.MapStyle = "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json"
	c.HistoryMinutes = 30
	c.HistoryMax = 20000
	c.PSKReporter.Enabled = true
	c.PSKReporter.Addr = "mqtt.pskreporter.info:1883"
	c.PSKReporter.Topics = []string{
		"pskr/filter/v2/+/+/{CALL}/#",   // who hears me
		"pskr/filter/v2/+/+/+/{CALL}/#", // who I hear (as reported by my own software)
	}
	c.RBN.Enabled = true
	c.RBN.Addrs = []string{"telnet.reversebeacon.net:7000"}
	c.Cluster.Addr = "dxc.nc7j.com:7373"
	c.WSJTX.Enabled = true
	c.WSJTX.Listen = "127.0.0.1:2237"
	c.NearKm = 1500
	c.Solar.Enabled = true
	c.Solar.IntervalMinutes = 10
	c.CTY.URL = "https://www.country-files.com/cty/cty.dat"
	c.Demo.Rate = 4
	return c
}

func loadConfig(path string) (Config, error) {
	c := defaultConfig()
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return c, nil
		}
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, err
	}
	c.Callsign = strings.ToUpper(strings.TrimSpace(c.Callsign))
	return c, nil
}
