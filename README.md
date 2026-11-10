# Where Is My Bus

Follow a bus from your phone, with no GPS on the bus. Search by bus number or place, see every stop
on a timeline, and track the journey using your phone's GPS or cell network.

- **Frontend:** React and Tailwind CSS (`src/`)
- **Backend:** Java 21 and Spring Boot (`backend/`). It downloads bus timetables, serves them to the
  app, passes rider positions between phones, and locates cell towers.
- **Mobile app:** React Native with Expo (`mobile/`). Native screens that share the website's tracking
  logic (`src/lib/`), plus a native module that reads cell towers on Android.

## Running it

You need [Node.js](https://nodejs.org) 20+ and a Java 21 JDK:

```
winget install Amazon.Corretto.21.JDK
```

Open a new terminal after installing, then start the backend. The first start downloads about 90 MB
of timetables, and you can use each region as soon as it has loaded.

```
cd backend
mvnw.cmd spring-boot:run
```

In a second terminal, start the frontend and open http://localhost:5173:

```
npm install
npm run dev
```

### Testing on a phone

Browsers only allow location access on `localhost` or HTTPS, so a phone needs HTTPS:

```
npm run dev:phone
```

Open the `https://` network address it prints, on a phone using the same Wi-Fi. Accept the
certificate warning, which appears because the certificate is self-signed.

### Going live

The website and the phone app both need the backend on the internet, so it goes first.

**1. Backend.** Host `backend/` anywhere that runs a Dockerfile, with at least 512 MB of memory. All
regions load in about 500 MB. It needs an `https` address, and it reads the port from `PORT`.

**2. Website.** On Netlify, set the environment variable `VITE_API_BASE` to the backend's address, such as
`https://your-backend.example.com`. `netlify.toml` covers the rest. To deploy from this computer:

```
$env:VITE_API_BASE = "https://your-backend.example.com"
npm run build
npx netlify-cli deploy --prod --dir=dist
```

**3. Mobile app.** See [Mobile app](#mobile-app-react-native) below.

To make towers known before riders have mapped them, get a free key from
[OpenCelliD](https://opencellid.org) and set it before starting the backend:

```
$env:OPENCELLID_KEY = "your-key"
```

### Tests

```
npm test
cd backend && mvnw.cmd test
```

## Mobile app (React Native)

`mobile/` is an [Expo](https://expo.dev) app (SDK 58, React Native 0.88). Its screens are native, and
its tracking, timetable and wording logic is imported from `src/lib/`, so the website and the app
always agree. It talks to the same backend.

**You need** [Node.js 22.13 or newer](https://nodejs.org) (Expo SDK 58 doesn't support older versions).

### Try it on your phone in 2 minutes (Expo Go)

1. Install **Expo Go** from the Play Store (or App Store) on your phone.
2. On your computer:

   ```
   cd mobile
   npm install
   npx expo start
   ```

3. Scan the QR code shown in the terminal with Expo Go (on iPhone, with the Camera app). Your phone and
   computer must be on the same Wi-Fi; if they aren't, run `npx expo start --tunnel` instead.

Everything works in Expo Go except reading cell towers directly: Expo Go can only run its own native
code, so **Cell tower** mode uses the phone's network location there.

### Install the full app (APK with cell towers)

Expo builds the APK in the cloud for free, so Android Studio isn't needed:

```
cd mobile
npx eas-cli@latest login        # free Expo account
npx eas-cli@latest build -p android --profile preview
```

When it finishes, open the link it prints on your phone to download and install the APK. The first
build asks to create a signing key; accept the default. (With Android Studio installed you can build
locally instead with `npx expo run:android`.)

### Settings

Copy `mobile/.env.example` to `mobile/.env`:

- `EXPO_PUBLIC_API_BASE`: the backend. Defaults to the Render backend.
- `EXPO_PUBLIC_SITE_URL`: your website's address. Family share links open there, so the **Share live
  location with family** button only appears once this is set.

Restart `npx expo start` after changing it, and rebuild the APK for it to reach the installed app.

### Checks

```
cd mobile
npx expo lint
npx expo-doctor
```

## How tracking works

Each bus has an **I'm on this bus** switch. Turning it on asks whether to use Cell tower or GPS, and
location isn't used until that's answered.

| Setting | Where the position comes from | Who it's for |
| --- | --- | --- |
| **Switch off** | GPS on the bus where a feed provides it, then riders sharing, then a timetable estimate | People waiting |
| **Cell tower** | Nearby towers read by the Android app, with network location as backup | People on the bus |
| **GPS** | The phone's GPS | People on the bus |

Positions are matched to the route in the browser (`src/lib/tracker.js`), using a Kalman filter that
tracks both distance and speed. Precise GPS fixes take over almost entirely, while coarse tower positions
only nudge the estimate. The timetable's speed is just a starting guess, so a wrong timetable doesn't
spoil tracking. In a simulated journey with readings about 800 m out, tracking error is about 280 m;
real-world accuracy hasn't been measured yet. Delay is the difference between the clock and when the
timetable has the bus at that point.

Live positions from GPS on the buses come from a GTFS-Realtime feed, set per feed with `realtime-url`
in `application.yml`. Pune has one. Those positions name a route but not a departure, so each bus is
matched to the departure the timetable puts nearest it (`assignBuses` in `journey.js`), which is a best
guess. Riders can also pick a bus from the list by its registration number.

Between-stops search counts any bus calling within 500 m of each named stop, so neighbouring stops with
different names still match (`Connections.java`).

Timetable estimates are always labelled as not live and never show a delay.

### Cell tower mode

Every 10 seconds, the Android app reads the towers it can see (`mobile/modules/cell-towers`) and asks the
backend where they are. The backend tries these in order:

1. **Learned map:** when a rider in GPS mode opts in to sharing, their position counts towards the
   location of their connected tower. A tower needs 3 samples before it's used, and samples that are
   imprecise or over 35 km from the others are rejected. Saved in `backend/data/learned-towers.csv`.
2. **OpenCelliD:** used if a key is set. Answers are cached, as the free tier limits daily requests.

If towers can't give a usable position, the app uses **network location** as its backup: the phone's
own low-accuracy positioning from towers and Wi-Fi. That happens when a tower is unknown, its coverage
is too wide to place the bus (over 5 km), or towers have given nothing for 45 seconds. The screen
always says which is in use. Towers already looked up on a journey keep working if the network drops.

In a browser, web pages can't read towers, so **Cell tower** only has the backup.

Tracking stops when the screen locks, in the browser and the app alike. The app asks to keep the screen
on while tracking, and it needs to stay open for tracking and stop alerts to work.

## Data sources

Feeds are listed in `backend/src/main/resources/application.properties`. Any GTFS zip can be added
there with no code changes. They're re-downloaded every 24 hours, and the last good copy stays in use
if a download fails.

| Region | Operators | Source | Status |
| --- | --- | --- | --- |
| Mumbai, Thane, Kalyan | BEST, TMT, KDMT, VVMT | [mumbai-gtfs](https://github.com/croyla/mumbai-gtfs) | Unofficial. BEST times look too fast |
| Pune, Pimpri-Chinchwad | PMPML | [pmpml-gtfs](https://github.com/croyla/pmpml-gtfs), with [live positions](https://pmpml-rt.blrtransit.com/) | Unofficial. Live feed isn't exhaustive and its address may change |
| Maharashtra | MSRTC | [msrtc-gtfs](https://github.com/croyla/msrtc-gtfs) | Unofficial, incomplete, no licence stated |
| Telangana | TGSRTC | [Open Data Telangana](https://data.telangana.gov.in/), via OpenCity | Government data. Times are repaired, see below |
| Pune Metro | Purple, Aqua and Pink lines | [OpenStreetMap](https://www.openstreetmap.org/relation/13917129), built into the app | Community data (ODbL). See below |

Maharashtra's operators don't publish open timetable data that we could find, so its feeds are
community-built. Check each source's terms, and ideally ask the operators, before launching publicly.
MSRTC in particular has no stated licence.

### Pune Metro

Pune Metro publishes no timetable data, so `tools/pune-metro/build-gtfs.mjs` builds a GTFS feed from
OpenStreetMap, where each line's stations are mapped in order. It's saved in
`backend/src/main/resources/feeds/pune-metro.zip` and ships with the app. To pick up changes in
OpenStreetMap, such as new stations or platform numbers, run `node tools/pune-metro/build-gtfs.mjs` and
redeploy.

- **Purple and Aqua lines:** departures follow the service hours, frequency (closer together at peak
  times) and end-to-end journey time mapped there. Times between stations divide that journey time by
  distance, as no per-station times are published.
- **Pink Line:** OpenStreetMap has no timings for it yet, so the converter uses the official timetable
  as reported at opening (every 5 min 30 s at peak, 10 min otherwise, 06:00 to 22:30 from Maan and 23:40
  from District Court, 45 minutes end to end). See `PUBLISHED` in the script for the sources.
- **No timings anywhere:** a line gets no timetable. The app still lists its stations and tracks it live
  from riders' phones.
- **Platforms:** numbers show where mappers have added them (a stop position's `ref`). As of November
  2026 that's only District Court on the Aqua Line.

The data is © OpenStreetMap contributors under the Open Database Licence, which the app credits.

### Repaired timings

TGSRTC's file has a calculation error: stop times were summed twice, so a 26 km city route appears
to take almost 12 hours. `TimingRepair.java` detects this from the data on each load and reverses
it, which brings the median speed from 1.5 to 19.9 km/h. Feeds without the problem are left alone.

## API

All under `/api/feeds`:

| Method and path | Purpose |
| --- | --- |
| `GET /` | Feeds and their status |
| `GET /{feed}/buses?q=` | Search by bus number or place |
| `GET /{feed}/stops?q=` | Stop name suggestions |
| `GET /{feed}/between?from=&to=` | Buses between two named stops |
| `GET /{feed}/services/{id}` | A bus's stops and today's departures |
| `GET /{feed}/services/{id}/buses` | Real buses on this route, from their GPS |
| `GET /{feed}/trip?id=` | One departure's timings |
| `GET /{feed}/trip/live?id=` | Where riders say this bus is |
| `POST /{feed}/trip/reports?id=` | Share a position from the bus |

Tower lookups are under `/api/cells`: `POST /locate` turns visible towers into a position, and
`POST /learn` adds a GPS position to the tower map.

Shared positions are reduced to distance along the route, held in memory for 3 minutes, and tied only
to a random ID that lasts one visit.
