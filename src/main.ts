import { Pond } from "./pond";

const pond = new Pond();

pond.init().catch((err) => {
    console.error("Failed to initialize the hardware-accelerated koi engine:", err);
});
