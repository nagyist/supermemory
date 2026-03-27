import { describe, it, expect } from "vitest"
import {
	normalizeDocCoordinates,
	getMemoryBorderColor,
	getEdgeVisualProps,
	screenToBackendCoords,
	calculateBackendViewport,
} from "../hooks/use-graph-data"
import { DEFAULT_COLORS } from "../constants"
import type { GraphApiDocument, GraphApiMemory } from "../types"

function makeDoc(id: string, x: number, y: number): GraphApiDocument {
	return {
		id,
		title: `Doc ${id}`,
		summary: null,
		documentType: "text",
		createdAt: "2024-01-01",
		updatedAt: "2024-01-01",
		x,
		y,
		memories: [],
	}
}

function makeMemory(overrides: Partial<GraphApiMemory> = {}): GraphApiMemory {
	return {
		id: "m1",
		memory: "test",
		isStatic: false,
		spaceId: "default",
		isLatest: true,
		isForgotten: false,
		forgetAfter: null,
		forgetReason: null,
		version: 1,
		parentMemoryId: null,
		rootMemoryId: null,
		createdAt: "2024-01-01",
		updatedAt: "2024-01-01",
		...overrides,
	}
}

describe("normalizeDocCoordinates", () => {
	it("normalizes coordinates to 100-900 range", () => {
		const docs = [
			makeDoc("a", 0, 0),
			makeDoc("b", 100, 100),
			makeDoc("c", 50, 50),
		]
		const result = normalizeDocCoordinates(docs)

		for (const doc of result) {
			expect(doc.x).toBeGreaterThanOrEqual(100)
			expect(doc.x).toBeLessThanOrEqual(900)
			expect(doc.y).toBeGreaterThanOrEqual(100)
			expect(doc.y).toBeLessThanOrEqual(900)
		}
	})

	it("maps min to 100 and max to 900", () => {
		const docs = [makeDoc("a", 0, 0), makeDoc("b", 100, 200)]
		const result = normalizeDocCoordinates(docs)

		expect(result[0]!.x).toBeCloseTo(100)
		expect(result[0]!.y).toBeCloseTo(100)
		expect(result[1]!.x).toBeCloseTo(900)
		expect(result[1]!.y).toBeCloseTo(900)
	})

	it("handles single document (returns as-is)", () => {
		const docs = [makeDoc("a", 500, 300)]
		const result = normalizeDocCoordinates(docs)
		expect(result).toEqual(docs)
	})

	it("handles empty array", () => {
		const result = normalizeDocCoordinates([])
		expect(result).toEqual([])
	})

	it("handles documents at same position", () => {
		const docs = [makeDoc("a", 50, 50), makeDoc("b", 50, 50)]
		// Should not throw (rangeX/rangeY fallback to 1)
		expect(() => normalizeDocCoordinates(docs)).not.toThrow()
	})

	it("preserves document data (only x/y change)", () => {
		const docs = [makeDoc("a", 0, 0), makeDoc("b", 100, 100)]
		const result = normalizeDocCoordinates(docs)
		expect(result[0]!.id).toBe("a")
		expect(result[0]!.title).toBe("Doc a")
		expect(result[1]!.id).toBe("b")
	})
})

describe("getMemoryBorderColor", () => {
	const colors = DEFAULT_COLORS

	it("returns forgotten color for forgotten memories", () => {
		const mem = makeMemory({ isForgotten: true })
		expect(getMemoryBorderColor(mem, colors)).toBe(colors.memBorderForgotten)
	})

	it("returns expiring color for memories expiring within 7 days", () => {
		const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
		const mem = makeMemory({ forgetAfter: soon })
		expect(getMemoryBorderColor(mem, colors)).toBe(colors.memBorderExpiring)
	})

	it("returns recent color for memories created within 24 hours", () => {
		const recent = new Date(Date.now() - 1000).toISOString()
		const mem = makeMemory({ createdAt: recent })
		expect(getMemoryBorderColor(mem, colors)).toBe(colors.memBorderRecent)
	})

	it("returns default color for normal memories", () => {
		const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
		const mem = makeMemory({ createdAt: old })
		expect(getMemoryBorderColor(mem, colors)).toBe(colors.memStrokeDefault)
	})

	it("forgotten takes priority over expiring", () => {
		const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
		const mem = makeMemory({ isForgotten: true, forgetAfter: soon })
		expect(getMemoryBorderColor(mem, colors)).toBe(colors.memBorderForgotten)
	})
})

describe("getEdgeVisualProps", () => {
	it("returns correct opacity and thickness for similarity 0", () => {
		const props = getEdgeVisualProps(0)
		expect(props.opacity).toBeCloseTo(0.3)
		expect(props.thickness).toBeCloseTo(1)
	})

	it("returns correct opacity and thickness for similarity 1", () => {
		const props = getEdgeVisualProps(1)
		expect(props.opacity).toBeCloseTo(0.8)
		expect(props.thickness).toBeCloseTo(2.5)
	})

	it("returns intermediate values for similarity 0.5", () => {
		const props = getEdgeVisualProps(0.5)
		expect(props.opacity).toBeCloseTo(0.55)
		expect(props.thickness).toBeCloseTo(1.75)
	})
})

describe("screenToBackendCoords", () => {
	it("converts screen coordinates to backend coordinates", () => {
		const result = screenToBackendCoords(400, 300, 0, 0, 1, 800, 600)
		expect(result.x).toBeDefined()
		expect(result.y).toBeDefined()
	})

	it("accounts for pan offset", () => {
		const noPan = screenToBackendCoords(400, 300, 0, 0, 1, 800, 600)
		const withPan = screenToBackendCoords(400, 300, 100, 50, 1, 800, 600)
		// Panning right means the backend coordinate should be smaller
		expect(withPan.x).toBeLessThan(noPan.x)
		expect(withPan.y).toBeLessThan(noPan.y)
	})

	it("accounts for zoom", () => {
		const zoom1 = screenToBackendCoords(400, 300, 0, 0, 1, 800, 600)
		const zoom2 = screenToBackendCoords(400, 300, 0, 0, 2, 800, 600)
		// At higher zoom, same screen position maps to smaller backend area
		expect(zoom2.x).toBeLessThan(zoom1.x)
	})
})

describe("calculateBackendViewport", () => {
	it("returns min/max bounds", () => {
		const bounds = calculateBackendViewport(0, 0, 1, 800, 600)
		expect(bounds.minX).toBeDefined()
		expect(bounds.maxX).toBeDefined()
		expect(bounds.minY).toBeDefined()
		expect(bounds.maxY).toBeDefined()
		expect(bounds.maxX).toBeGreaterThan(bounds.minX)
		expect(bounds.maxY).toBeGreaterThan(bounds.minY)
	})

	it("higher zoom produces smaller viewport", () => {
		const zoom1 = calculateBackendViewport(0, 0, 1, 800, 600)
		const zoom2 = calculateBackendViewport(0, 0, 2, 800, 600)
		const area1 = (zoom1.maxX - zoom1.minX) * (zoom1.maxY - zoom1.minY)
		const area2 = (zoom2.maxX - zoom2.minX) * (zoom2.maxY - zoom2.minY)
		expect(area2).toBeLessThan(area1)
	})

	it("minX is non-negative", () => {
		const bounds = calculateBackendViewport(0, 0, 1, 800, 600)
		expect(bounds.minX).toBeGreaterThanOrEqual(0)
		expect(bounds.minY).toBeGreaterThanOrEqual(0)
	})
})
