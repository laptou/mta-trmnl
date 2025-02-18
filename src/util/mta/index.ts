import { parse } from "csv-parse/sync";
import { Temporal } from "temporal-polyfill";
import yauzl from "yauzl";

function parseGtfsTime(time: string): Temporal.PlainTime {
	const [hours, minutes, seconds] = time
		.split(":")
		.map((n) => Number.parseInt(n, 10));
	// Handle times past midnight by wrapping back to 0-23 range
	return Temporal.PlainTime.from({
		hour: hours % 24,
		minute: minutes,
		second: seconds,
	});
}

function parseGtfsDate(date: string): Temporal.PlainDate {
	const year = Number.parseInt(date.slice(0, 4));
	const month = Number.parseInt(date.slice(4, 6));
	const day = Number.parseInt(date.slice(6, 8));
	return Temporal.PlainDate.from({ year, month, day });
}

const zipFromBuffer = (buf: Buffer, opts: yauzl.Options) =>
	new Promise<yauzl.ZipFile>((resolve, reject) =>
		yauzl.fromBuffer(buf, opts, (err, archive) => {
			if (err) reject(err);
			resolve(archive);
		}),
	);

interface CalendarEntry {
	service_id: string;
	monday: boolean;
	tuesday: boolean;
	wednesday: boolean;
	thursday: boolean;
	friday: boolean;
	saturday: boolean;
	sunday: boolean;
	start_date: Temporal.PlainDate;
	end_date: Temporal.PlainDate;
}

interface CalendarDateEntry {
	service_id: string;
	date: string;
	exception_type: number;
}

interface Route {
	agency_id: string;
	route_id: string;
	route_short_name: string;
	route_long_name: string;
	route_type: number;
	route_desc?: string;
	route_url?: string;
	route_color?: string;
	route_text_color?: string;
}

interface StopTime {
	trip_id: string;
	stop_id: string;
	arrival_time: Temporal.PlainTime;
	departure_time: Temporal.PlainTime;
	stop_sequence: number;
}

interface Stop {
	stop_id: string;
	stop_name: string;
	stop_lat: number;
	stop_lon: number;
	location_type?: number;
	parent_station?: string;
}

interface Transfer {
	from_stop_id: string;
	to_stop_id: string;
	transfer_type: number;
	min_transfer_time?: number;
}

export interface Station {
	id: string;
	name: string;
	location: {
		lat: number;
		lon: number;
	};
	lines: string[];
}

export interface TrainArrival {
	line: string;
	tripId: string;
	arrivalTime: Temporal.PlainTime;
	departureTime: Temporal.PlainTime;
	stopSequence: number;
}

export interface MtaState {
	calendar: CalendarEntry[];
	calendarDates: CalendarDateEntry[];
	routes: Route[];
	stopTimes: StopTime[];
	stops: Stop[];
	transfers: Transfer[];
	lastUpdated: Date;

	// Derived data
	stations: Map<string, Station>;
	lineToStations: Map<string, Set<string>>;
}

async function readZipEntries(
	zip: yauzl.ZipFile,
): Promise<Map<string, string>> {
	return new Promise((resolve, reject) => {
		const entries = new Map<string, string>();

		zip.on("error", reject);

		zip.on("entry", (entry: yauzl.Entry) => {
			if (entry.fileName === "shapes.txt") {
				zip.readEntry();
				return;
			}

			zip.openReadStream(entry, (err, stream) => {
				if (err) {
					reject(err);
					return;
				}

				const data: Buffer[] = [];
				stream.on("data", (chunk) => data.push(Buffer.from(chunk)));

				stream.on("end", () => {
					entries.set(entry.fileName, Buffer.concat(data).toString("utf-8"));
					zip.readEntry();
				});

				stream.on("error", reject);
			});
		});

		zip.on("end", () => resolve(entries));

		zip.readEntry();
	});
}

export const MTA_SUPPLEMENTED_GTFS_STATIC_URL =
	"https://rrgtfsfeeds.s3.amazonaws.com/gtfs_supplemented.zip";

export async function loadMtaBaselineState(zipPath: string): Promise<MtaState> {
	const gtfsData = await fetch(zipPath).then((res) => res.arrayBuffer());
	const gtfsArchive = await zipFromBuffer(Buffer.from(gtfsData), {
		lazyEntries: true,
	});
	const entries = await readZipEntries(gtfsArchive);

	function parseCsvFile<T>(filename: string): T[] {
		const data = entries.get(filename);
		if (!data) throw new Error(`File ${filename} not found in zip`);
		return parse(data, {
			columns: true,
			cast: false,
			skipEmptyLines: true,
		});
	}

	const rawCalendar = parseCsvFile<
		Omit<CalendarEntry, "start_date" | "end_date"> & {
			start_date: string;
			end_date: string;
		}
	>("calendar.txt");

	const calendarDates = parseCsvFile<CalendarDateEntry>("calendar_dates.txt");
	const routes = parseCsvFile<Route>("routes.txt");
	const rawStopTimes = parseCsvFile<
		Omit<StopTime, "arrival_time" | "departure_time"> & {
			arrival_time: string;
			departure_time: string;
		}
	>("stop_times.txt");
	const stops = parseCsvFile<Stop>("stops.txt");
	const transfers = parseCsvFile<Transfer>("transfers.txt");

	// Convert date strings to Temporal.PlainDate
	const calendar = rawCalendar.map((entry) => ({
		...entry,
		start_date: parseGtfsDate(entry.start_date),
		end_date: parseGtfsDate(entry.end_date),
	}));

	// Convert time strings to Temporal.PlainTime
	const stopTimes = rawStopTimes.map((entry) => ({
		...entry,
		arrival_time: parseGtfsTime(entry.arrival_time),
		departure_time: parseGtfsTime(entry.departure_time),
	}));

	// Build derived data structures
	const stations = new Map<string, Station>();
	const lineToStations = new Map<string, Set<string>>();

	// Process stops into stations
	for (const stop of stops) {
		if (!stop.parent_station) {
			// Only process parent stations
			stations.set(stop.stop_id, {
				id: stop.stop_id,
				name: stop.stop_name,
				location: {
					lat: stop.stop_lat,
					lon: stop.stop_lon,
				},
				lines: [],
			});
		}
	}

	// Map routes to stations
	for (const route of routes) {
		const stationsForLine = new Set<string>();
		lineToStations.set(route.route_id, stationsForLine);

		// Find all stops for this route
		const routeStopTimes = stopTimes.filter((st) =>
			st.trip_id.startsWith(route.route_id),
		);

		for (const st of routeStopTimes) {
			const station = stations.get(st.stop_id);
			if (station) {
				stationsForLine.add(station.id);
				if (!station.lines.includes(route.route_id)) {
					station.lines.push(route.route_id);
				}
			}
		}
	}

	return {
		calendar,
		calendarDates,
		routes,
		stopTimes,
		stops,
		transfers,
		lastUpdated: new Date(),
		stations,
		lineToStations,
	};
}

export function getAllLines(state: MtaState): Route[] {
	return state.routes;
}

export function getStationsForLine(state: MtaState, lineId: string): Station[] {
	const stationIds = state.lineToStations.get(lineId) || new Set();
	return Array.from(stationIds)
		.map((id) => state.stations.get(id))
		.filter((station): station is Station => station !== undefined);
}

export function getNextTrainsByDirection(
    state: MtaState,
    stationId: string,
    lineId: string
): { north: TrainArrival | null; south: TrainArrival | null } {
    const now = Temporal.Now.plainTimeISO();
    const stationArrivals = state.stopTimes
        .filter(
            (st) =>
                st.stop_id === stationId &&
                st.trip_id.startsWith(lineId) &&
                Temporal.PlainTime.compare(st.arrival_time, now) > 0
        )
        .map((st) => ({
            line: st.trip_id.split(".")[0],
            tripId: st.trip_id,
            arrivalTime: st.arrival_time,
            departureTime: st.departure_time,
            stopSequence: st.stop_sequence,
        }));

    // Group by direction (assuming higher stop_sequence = northbound)
    const byDirection = stationArrivals.reduce(
        (acc, arrival) => {
            if (!acc.north || arrival.stopSequence > acc.north.stopSequence) {
                acc.north = arrival;
            }
            if (!acc.south || arrival.stopSequence < acc.south.stopSequence) {
                acc.south = arrival;
            }
            return acc;
        },
        { north: null as TrainArrival | null, south: null as TrainArrival | null }
    );

    return byDirection;
}

export function getUpcomingArrivals(
    state: MtaState,
    stationId: string,
    limit = 10
): TrainArrival[] {
    const now = Temporal.Now.plainTimeISO();

    return state.stopTimes
        .filter(
            (st) =>
                st.stop_id === stationId &&
                Temporal.PlainTime.compare(st.arrival_time, now) > 0
        )
        .sort((a, b) => Temporal.PlainTime.compare(a.arrival_time, b.arrival_time))
        .slice(0, limit)
        .map((st) => ({
            line: st.trip_id.split(".")[0],
            tripId: st.trip_id,
            arrivalTime: st.arrival_time,
            departureTime: st.departure_time,
            stopSequence: st.stop_sequence,
        }));
}

export function getStation(state: MtaState, stationId: string): Station | undefined {
    return state.stations.get(stationId);
}
