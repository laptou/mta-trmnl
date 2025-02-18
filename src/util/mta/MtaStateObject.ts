import { DurableObject } from "cloudflare:workers";
import { parse } from "csv-parse/sync";
import { Temporal } from "temporal-polyfill";
import yauzl from "yauzl";

export class MtaStateObject extends DurableObject {
  constructor(state: DurableObjectState, env: any) {
    super(state, env);

    // Initialize database schema when object is created
    state.blockConcurrencyWhile(async () => {
      await this.initializeDatabase();
    });
  }

  private async initializeDatabase() {
    // Create tables
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS calendar (
        service_id TEXT PRIMARY KEY,
        monday INTEGER,
        tuesday INTEGER,
        wednesday INTEGER, 
        thursday INTEGER,
        friday INTEGER,
        saturday INTEGER,
        sunday INTEGER,
        start_date TEXT,
        end_date TEXT
      );

      CREATE TABLE IF NOT EXISTS calendar_dates (
        service_id TEXT,
        date TEXT,
        exception_type INTEGER,
        PRIMARY KEY (service_id, date)
      );

      CREATE TABLE IF NOT EXISTS routes (
        route_id TEXT PRIMARY KEY,
        agency_id TEXT,
        route_short_name TEXT,
        route_long_name TEXT,
        route_type INTEGER,
        route_desc TEXT,
        route_url TEXT,
        route_color TEXT,
        route_text_color TEXT
      );

      CREATE TABLE IF NOT EXISTS stop_times (
        trip_id TEXT,
        stop_id TEXT,
        arrival_hours INTEGER,
        arrival_minutes INTEGER,
        arrival_seconds INTEGER,
        departure_hours INTEGER,
        departure_minutes INTEGER,
        departure_seconds INTEGER,
        stop_sequence INTEGER,
        PRIMARY KEY (trip_id, stop_id)
      );

      CREATE TABLE IF NOT EXISTS stops (
        stop_id TEXT PRIMARY KEY,
        stop_name TEXT,
        stop_lat REAL,
        stop_lon REAL,
        location_type INTEGER,
        parent_station TEXT
      );

      CREATE TABLE IF NOT EXISTS transfers (
        from_stop_id TEXT,
        to_stop_id TEXT,
        transfer_type INTEGER,
        min_transfer_time INTEGER,
        PRIMARY KEY (from_stop_id, to_stop_id)
      );

      CREATE TABLE IF NOT EXISTS trips (
        route_id TEXT,
        trip_id TEXT PRIMARY KEY,
        service_id TEXT,
        trip_headsign TEXT,
        direction_id TEXT,
        shape_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_stop_times_stop_id ON stop_times(stop_id);
      CREATE INDEX IF NOT EXISTS idx_trips_route_id ON trips(route_id);
      CREATE INDEX IF NOT EXISTS idx_stops_parent_station ON stops(parent_station);
    `);
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    // Handle different endpoints
    switch (url.pathname) {
      case "/load":
        if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
        return await this.handleLoad(request);

      case "/getAllLines":
        return await this.handleGetAllLines();

      case "/getStationsForLine":
        return await this.handleGetStationsForLine(url.searchParams);

      case "/getStation":
        return await this.handleGetStation(url.searchParams);

      case "/getUpcomingArrivals":
        return await this.handleGetUpcomingArrivals(url.searchParams);

      default:
        return new Response("Not found", { status: 404 });
    }
  }
}
