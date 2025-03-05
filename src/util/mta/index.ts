import { z } from "astro/zod";
import { Temporal } from "temporal-polyfill";

async function trace<T>(label: string, inner: () => Promise<T>): Promise<T> {
	const start = performance.now();
	try {
		const result = await inner();
		const duration = performance.now() - start;
		console.log(`${label} - ${duration}ms`);
		return result;
	} catch (error) {
		const duration = performance.now() - start;
		console.error(`${label} - ERR ${error} - ${duration}ms`);
		throw error;
	}
}

//
// Global configuration: adjust this to point to your DO origin.
//
const BACKEND_ORIGIN = import.meta.env.DEV
	? "http://localhost:8787"
	: "https://mta-cf-api.ibiyemi.workers.dev";

const plainDateSchema = z.string().transform((t) => Temporal.PlainDate.from(t));
const plainTimeSchema = z.string().transform((t) => Temporal.PlainTime.from(t));

// Route schema with camelCase
const routeSchema = z.object({
	agencyId: z.string(),
	routeId: z.string(),
	routeShortName: z.string(),
	routeLongName: z.string(),
	routeType: z.number(),
	routeDesc: z.string().nullable(),
	routeUrl: z.string().nullable(),
	routeColor: z.string().nullable(),
	routeTextColor: z.string().nullable(),
});

export type Route = z.infer<typeof routeSchema>;

// Station schema.
const stationSchema = z.object({
	stopId: z.string(),
	stopCode: z.string().nullable().optional(),
	stopName: z.string(),
	stopDesc: z.string().nullable().optional(),
	stopLat: z.number(),
	stopLon: z.number(),
	zoneId: z.string().nullable().optional(),
	stopUrl: z.string().nullable().optional(),
	locationType: z.number().nullable().optional(),
	parentStation: z.string().nullable().optional(),
	stopTimezone: z.string().nullable().optional(),
	wheelchairBoarding: z.number().nullable().optional(),
	levelId: z.string().nullable().optional(),
	platformCode: z.string().nullable().optional(),
});

export type Station = z.infer<typeof stationSchema>;

// TrainArrival schema
const stopTimeSchema = z.object({
	route: z.string(),
	tripId: z.string(),
	stopId: z.string(),
	stopName: z.string(),
	arrivalTime: plainTimeSchema,
	departureTime: plainTimeSchema,
	isRealtimeUpdated: z.boolean(),
	stopSequence: z.number(),
});
export type StopTime = z.infer<typeof stopTimeSchema>;

// Calendar entry schema.
const calendarEntrySchema = z.object({
	serviceId: z.string(),
	monday: z.enum(["0", "1"]),
	tuesday: z.enum(["0", "1"]),
	wednesday: z.enum(["0", "1"]),
	thursday: z.enum(["0", "1"]),
	friday: z.enum(["0", "1"]),
	saturday: z.enum(["0", "1"]),
	sunday: z.enum(["0", "1"]),
	startDate: plainDateSchema,
	endDate: plainDateSchema,
});

export type CalendarEntry = z.infer<typeof calendarEntrySchema>;

// Calendar Date Entry schema
const calendarDateEntrySchema = z.object({
	serviceId: z.string(),
	date: plainDateSchema,
	exceptionType: z.number(),
});
export type CalendarDateEntry = z.infer<typeof calendarDateEntrySchema>;

// Expanded station schema with upcoming arrivals
const expandedStationSchema = stationSchema.extend({
	upcomingArrivals: z.array(stopTimeSchema),
});

// Expanded route schema
const expandedRouteSchema = z.object({
	route: routeSchema,
	stations: z.array(expandedStationSchema),
});

export type ExpandedRoute = z.infer<typeof expandedRouteSchema>;
export type ExpandedStation = z.infer<typeof expandedStationSchema>;

/**
 * Get details about a specific route, optionally including all stations and upcoming arrivals.
 *
 *
 */
export async function getRoute(
	routeId: string,
	expanded: true,
): Promise<ExpandedRoute>;
export async function getRoute(
	routeId: string,
	expanded: false,
): Promise<Route>;
export async function getRoute(
	routeId: string,
	expanded = false,
): Promise<Route | ExpandedRoute> {
	const url = new URL(`${BACKEND_ORIGIN}/route`);
	url.searchParams.set("routeId", routeId);
	if (expanded) {
		url.searchParams.set("expanded", "true");
	}

	const res = await trace("getRoute", () => fetch(url.toString()));
	if (!res.ok)
		throw new Error(`getRoute failed: ${res.status} ${res.statusText}`);

	const json = await res.json();
	return expanded ? expandedRouteSchema.parse(json) : routeSchema.parse(json);
}

/**
 * Get a list of all available routes.
 */
export async function getAllRoutes(): Promise<Route[]> {
	const res = await trace("getAllRoutes", () =>
		fetch(`${BACKEND_ORIGIN}/routes`),
	);
	if (!res.ok)
		throw new Error(`getAllRoutes failed: ${res.status} ${res.statusText}`);
	const json = await res.json();
	return z.array(routeSchema).parse(json);
}

/**
 * Returns stations for a given route id from the DO.
 */
export async function getStationsForRoute(routeId: string): Promise<Station[]> {
	const url = new URL(`${BACKEND_ORIGIN}/stations`);
	url.searchParams.set("routeId", routeId);
	const res = await trace("getStationsForRoute", () => fetch(url.toString()));
	if (!res.ok)
		throw new Error(
			`getStationsForRoute failed: ${res.status} ${res.statusText}`,
		);
	const json = await res.json();
	return z.array(stationSchema).parse(json);
}

/**
 * Returns station details from the DO.
 * @param stationId Single station ID or comma-separated list of station IDs
 */
export async function getStations(
	stationId: string | string[],
): Promise<Station[]> {
	const url = new URL(`${BACKEND_ORIGIN}/station`);
	const stationIds = Array.isArray(stationId) ? stationId.join(",") : stationId;
	url.searchParams.set("stationId", stationIds);

	const res = await trace("getStation", () => fetch(url.toString()));
	if (!res.ok)
		throw new Error(`getStation failed: ${res.status} ${res.statusText}`);

	const json = await res.json();
	return z.array(stationSchema).parse(json);
}

/**
 * Returns upcoming train arrivals for a given station.
 * We assume the DO returns arrival/departure times as ISO strings in HH:mm:ss format.
 * We then use zod to validate and convert these values into Temporal.PlainTime.
 *
 * @param stationId The ID of the station
 * @param routeId Optional filter for specific route
 * @param limit Maximum number of arrivals to return (default: 10, max: 15)
 */
export async function getUpcomingArrivals(
	stationId: string,
	routeId?: string,
	limit = 10,
): Promise<StopTime[]> {
	const url = new URL(`${BACKEND_ORIGIN}/arrivals`);
	url.searchParams.set("stationId", stationId);
	if (routeId) url.searchParams.set("routeId", routeId);
	url.searchParams.set("limit", Math.min(limit, 15).toString());

	const res = await trace("getUpcomingArrivals", () => fetch(url.toString()));
	if (!res.ok)
		throw new Error(
			`getUpcomingArrivals failed: ${res.status} ${res.statusText}`,
		);

	const json = await res.json();
	return z.array(stopTimeSchema).parse(json);
}
