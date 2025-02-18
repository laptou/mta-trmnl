import { parse } from "csv-parse/sync";
import JSZip from "jszip";

interface CalendarEntry {
	service_id: string;
	monday: boolean;
	tuesday: boolean;
	wednesday: boolean;
	thursday: boolean;
	friday: boolean;
	saturday: boolean;
	sunday: boolean;
	start_date: string;
	end_date: string;
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
	arrival_time: string;
	departure_time: string;
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
    arrivalTime: string;
    departureTime: string;
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

async function readCsvFromZip<T>(zip: JSZip, filename: string): Promise<T[]> {
	const file = await zip.file(filename)?.async("string");

	if (!file) {
		throw new Error(`File ${filename} not found in zip`);
	}

	return parse(file, {
		columns: true,
		cast: true,
		skipEmptyLines: true,
	});
}

export const MTA_SUPPLEMENTED_GTFS_STATIC_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_supplemented.zip";

export async function loadMtaBaselineState(zipPath: string): Promise<MtaState> {
    const zip = await JSZip.loadAsync(
        await fetch(zipPath).then((res) => res.blob()),
    );

    const [calendar, calendarDates, routes, stopTimes, stops, transfers] =
        await Promise.all([
            readCsvFromZip<CalendarEntry>(zip, "calendar.txt"),
            readCsvFromZip<CalendarDateEntry>(zip, "calendar_dates.txt"),
            readCsvFromZip<Route>(zip, "routes.txt"),
            readCsvFromZip<StopTime>(zip, "stop_times.txt"),
            readCsvFromZip<Stop>(zip, "stops.txt"),
            readCsvFromZip<Transfer>(zip, "transfers.txt"),
        ]);

    // Build derived data structures
    const stations = new Map<string, Station>();
    const lineToStations = new Map<string, Set<string>>();

    // Process stops into stations
    for (const stop of stops) {
        if (!stop.parent_station) { // Only process parent stations
            stations.set(stop.stop_id, {
                id: stop.stop_id,
                name: stop.stop_name,
                location: {
                    lat: stop.stop_lat,
                    lon: stop.stop_lon
                },
                lines: []
            });
        }
    }

    // Map routes to stations
    for (const route of routes) {
        const stationsForLine = new Set<string>();
        lineToStations.set(route.route_id, stationsForLine);

        // Find all stops for this route
        const routeStopTimes = stopTimes.filter(st => 
            st.trip_id.startsWith(route.route_id));
        
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
        lineToStations
    };
}

export function getAllLines(state: MtaState): Route[] {
    return state.routes;
}

export function getStationsForLine(state: MtaState, lineId: string): Station[] {
    const stationIds = state.lineToStations.get(lineId) || new Set();
    return Array.from(stationIds)
        .map(id => state.stations.get(id))
        .filter((station): station is Station => station !== undefined);
}

export function getUpcomingArrivals(state: MtaState, stationId: string, limit = 10): TrainArrival[] {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                       now.getMinutes().toString().padStart(2, '0') + ':' + 
                       now.getSeconds().toString().padStart(2, '0');

    return state.stopTimes
        .filter(st => st.stop_id === stationId && st.arrival_time > currentTime)
        .sort((a, b) => a.arrival_time.localeCompare(b.arrival_time))
        .slice(0, limit)
        .map(st => ({
            line: st.trip_id.split('.')[0], // Assuming trip_id format is "line.trip"
            tripId: st.trip_id,
            arrivalTime: st.arrival_time,
            departureTime: st.departure_time,
            stopSequence: st.stop_sequence
        }));
}
