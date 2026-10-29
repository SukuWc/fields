export const EXAMPLE_CUSTOM_TOML = `
scenario = "custom"
map_width_m = 100
map_height_m = 200
wind_angle_deg = 90
wind_speed_mps = 4.5

[custom]
title = "Windward-leeward, 2 laps"
description = "Start between the committee boat and the pin, round w1 to port, pass the leeward gate, two laps, finish upwind of the gate."

[custom.marks]
rc = [24, -70]
pin = [-8, -70]
w1 = [8, 60]
g2w = [2, -50]
g2e = [14, -50]
fb = [26, -20]
fp = [6, -20]

[custom.start]
committee = "rc"
pin = "pin"
timings = "compressed"
lead_s = 2

[custom.course]
laps = 2
legs = [
  { mark = "w1", round = "port" },
  { gate = ["g2w", "g2e"] },
]

[custom.finish]
committee = "fb"
pin = "fp"

[custom.boundary]
inset_m = 8
zone_m = 15
y_min_m = -90
y_max_m = 90
`;
