import { defineMiddleware } from "astro:middleware";

export default defineMiddleware(async (event, next) => {
    const start = performance.now();
    try {
        const response = await next();
        const duration = performance.now() - start;
        console.log(`${event.url} - ${response.status} - ${duration}ms`);
        return response;
    } catch (error) {
        const duration = performance.now() - start;
        console.error(`${event.url} - ERR ${error} - ${duration}ms`);
        throw error;
    }
});
