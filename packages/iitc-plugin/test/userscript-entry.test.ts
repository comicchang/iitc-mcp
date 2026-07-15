import { afterEach, describe, expect, it, vi } from "vitest";

const transportStart = vi.fn();
const injectPageAdapter = vi.fn();

vi.mock("../src/transport.js", () => ({
	BridgeTransport: class {
		start = transportStart;
	},
}));

function createMockDocument() {
	const script = { textContent: "", remove: vi.fn() };
	return {
		script,
		head: {
			appendChild: vi.fn((node: unknown) => {
				injectPageAdapter();
				return node;
			}),
		},
		documentElement: {},
		createElement: vi.fn(() => script),
		addEventListener: vi.fn(),
	};
}

describe("userscript entry", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		transportStart.mockReset();
		injectPageAdapter.mockReset();
	});

	it("registers sandbox listeners before injecting the page adapter", async () => {
		const mockDocument = createMockDocument();
		vi.stubGlobal("document", mockDocument);
		vi.stubGlobal("window", { addEventListener: vi.fn() });
		vi.stubGlobal("GM_xmlhttpRequest", vi.fn());
		vi.stubGlobal("PAGE_ADAPTER_SOURCE", "");

		await import("../src/userscript-entry.js");

		expect(transportStart).toHaveBeenCalledBefore(injectPageAdapter);
	});
});
