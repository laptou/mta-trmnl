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
const trainArrivalSchema = z.object({
	line: z.string(),
	tripId: z.string(),
	stopId: z.string(),
	stopName: z.string(),
	arrivalTime: plainTimeSchema,
	departureTime: plainTimeSchema,
	stopSequence: z.number(),
});
export type TrainArrival = z.infer<typeof trainArrivalSchema>;

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

// --- Helper functions using DO backend with zod validation ---

/**
 * Returns all lines (routes) from the DO.
 */
export async function getAllLines(): Promise<Route[]> {
	const res = await fetch(`${BACKEND_ORIGIN}/lines`);
	if (!res.ok)
		throw new Error(`getAllLines failed: ${res.status} ${res.statusText}`);
	const json = await res.json();
	return z.array(routeSchema).parse(json);
}

/**
 * Returns stations for a given line id from the DO.
 */
export async function getStationsForLine(lineId: string): Promise<Station[]> {
	const url = new URL(`${BACKEND_ORIGIN}/stations`);
	url.searchParams.set("lineId", lineId);
	const res = await fetch(url.toString());
	if (!res.ok)
		throw new Error(
			`getStationsForLine failed: ${res.status} ${res.statusText}`,
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
	lineId: string | undefined = undefined,
	limit = 10,
): Promise<TrainArrival[]> {
	const url = new URL(`${BACKEND_ORIGIN}/arrivals`);
	url.searchParams.set("stationId", stationId);
	if (lineId) url.searchParams.set("lineId", lineId);
	url.searchParams.set("limit", limit.toString());
	const res = await fetch(url.toString());
	if (!res.ok)
		throw new Error(
			`getUpcomingArrivals failed: ${res.status} ${res.statusText}`,
		);
	const json = await res.json();
	return z.array(trainArrivalSchema).parse(json);
}
