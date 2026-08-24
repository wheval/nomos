import { MemoryStore } from "./memoryStore";
import { runStoreContractTests } from "./contractTests";

runStoreContractTests("memory", () => new MemoryStore());
