import { z } from "astro/zod";
import { Temporal } from "temporal-polyfill";

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

export async function getRoute(routeId: string): Promise<Route> {
	const res = await fetch(`${BACKEND_ORIGIN}/route?routeId=${routeId}`);
	if (!res.ok)
		throw new Error(`getAllroutes failed: ${res.status} ${res.statusText}`);
	const json = await res.json();
	return routeSchema.parse(json);
}

export async function getAllRoutes(): Promise<Route[]> {
	const res = await fetch(`${BACKEND_ORIGIN}/routes`);
	if (!res.ok)
		throw new Error(`getAllroutes failed: ${res.status} ${res.statusText}`);
	const json = await res.json();
	return z.array(routeSchema).parse(json);
}

/**
 * Returns stations for a given route id from the DO.
 */
export async function getStationsForRoute(routeId: string): Promise<Station[]> {
	const url = new URL(`${BACKEND_ORIGIN}/stations`);
	url.searchParams.set("routeId", routeId);
	const res = await fetch(url.toString());
	if (!res.ok)
		throw new Error(
			`getStationsForroute failed: ${res.status} ${res.statusText}`,
		);
	const json = await res.json();
	return z.array(stationSchema).parse(json);
}

/**
 * Returns station details from the DO.
 */
export async function getStation(
	stationId: string,
): Promise<Station | undefined> {
	const url = new URL(`${BACKEND_ORIGIN}/station`);
	url.searchParams.set("stationId", stationId);
	const res = await fetch(url.toString());
	if (res.status === 404) return undefined;
	if (!res.ok)
		throw new Error(`getStation failed: ${res.status} ${res.statusText}`);
	const json = await res.json();
	return stationSchema.parse(json);
}

/**
 * Returns upcoming train arrivals for a given station.
 * We assume the DO returns arrival/departure times as ISO strings in HH:mm:ss format.
 * We then use zod to validate and convert these values into Temporal.PlainTime.
 */
export async function getUpcomingArrivals(
	stationId: string,
	routeId: string | undefined = undefined,
	limit = 10,
): Promise<StopTime[]> {
	const url = new URL(`${BACKEND_ORIGIN}/arrivals`);
	url.searchParams.set("stationId", stationId);
	if (routeId) url.searchParams.set("routeId", routeId);
	url.searchParams.set("limit", limit.toString());
	const res = await fetch(url.toString());
	if (!res.ok)
		throw new Error(
			`getUpcomingArrivals failed: ${res.status} ${res.statusText}`,
		);
	const json = await res.json();
	return z.array(stopTimeSchema).parse(json);
}
