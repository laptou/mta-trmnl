import JSZip from 'jszip';
import { parse } from 'csv-parse/sync';

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

export interface MtaState {
    calendar: CalendarEntry[];
    calendarDates: CalendarDateEntry[];
    routes: Route[];
    stopTimes: StopTime[];
    stops: Stop[];
    transfers: Transfer[];
    lastUpdated: Date;
}

async function readCsvFromZip<T>(zip: JSZip, filename: string): Promise<T[]> {
    const file = await zip.file(filename)?.async('string');

    if (!file) {
        throw new Error(`File ${filename} not found in zip`);
    }
    
    return parse(file, {
        columns: true,
        cast: true,
        skipEmptyLines: true
    });
}

export async function loadMtaState(zipPath: string): Promise<MtaState> {
    const zip = await JSZip.loadAsync(await fetch(zipPath).then(res => res.blob()));

    const [calendar, calendarDates, routes, stopTimes, stops, transfers] = await Promise.all([
        readCsvFromZip<CalendarEntry>(zip, 'calendar.txt'),
        readCsvFromZip<CalendarDateEntry>(zip, 'calendar_dates.txt'),
        readCsvFromZip<Route>(zip, 'routes.txt'),
        readCsvFromZip<StopTime>(zip, 'stop_times.txt'),
        readCsvFromZip<Stop>(zip, 'stops.txt'),
        readCsvFromZip<Transfer>(zip, 'transfers.txt')
    ]);

    return {
        calendar,
        calendarDates,
        routes,
        stopTimes,
        stops,
        transfers,
        lastUpdated: new Date()
    };
}
