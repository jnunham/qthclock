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

	// Wavelog shows your latest QSOs. APIKey: a Wavelog 3.1+ token ("wl2_...")
	// or a classic read-only API key (then StationID is required too).
	Wavelog struct {
		Enabled         bool   `json:"enabled"`
		URL             string `json:"url"`
		APIKey          string `json:"apiKey"`
		StationID       string `json:"stationId"`
		IntervalSeconds int    `json:"intervalSeconds"`
		SkipTLSVerify   bool   `json:"skipTLSVerify"` // for a self-signed certificate
	} `json:"wavelog"`

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
	c.HistoryMinutes = 30
	c.HistoryMax = 20000
	c.PSKReporter.Enabled = true
	c.PSKReporter.Addr = "mqtt.pskreporter.info:1883"
	c.PSKReporter.Topics = []string{
		"pskr/filter/v2/+/+/{CALL}/#", // who hears me
	}
	c.RBN.Enabled = true
	c.RBN.Addrs = []string{"telnet.reversebeacon.net:7000", "telnet.reversebeacon.net:7001"} // CW/RTTY, FT8/FT4
	c.Cluster.Addr = "dxc.nc7j.com:7373"
	c.NearKm = 1500
	c.Wavelog.IntervalSeconds = 60
	c.Solar.Enabled = true
	c.Solar.IntervalMinutes = 10
	c.CTY.URL = "https://www.country-files.com/cty/cty.dat"
	c.Demo.Rate = 4
	return c
}

// configured reports whether the operator has entered their station.
func (c Config) configured() bool { return c.Callsign != "" && c.Grid != "" }

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
