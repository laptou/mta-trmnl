interface Station {
    id: string;
    name: string;
    location: {
        lat: number;
        lon: number;
    };
    lines: string[];
    upcoming_trains: Array<{
        line: string;
        arrival_time: Date;
        direction: string;
        trip_id: string;
    }>;
    service_changes: Array<{
        type: string;
        description: string;
        start_time: Date;
        end_time: Date;
    }>;
}

interface MtaState {
    stations: Map<string, Station>;
    last_updated: Date;
}

interface GtfsFiles {
    agency: string;
    routes: string;
    trips: string;
    stops: string;
    stop_times: string;
    calendar: string;
    calendar_dates: string;
    shapes: string;
    transfers: string;
}

export async function buildMtaState(gtfsZipPath: string): Promise<MtaState> {
    // TODO: Implement parsing logic once CSV column definitions are provided
    throw new Error("Not implemented");
}
