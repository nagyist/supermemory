import { describe, it, expect } from "vitest"
import { VersionChainIndex } from "../canvas/version-chain"
import type { GraphApiDocument, GraphApiMemory } from "../types"

function makeMem(overrides: Partial<GraphApiMemory> & { id: string }): GraphApiMemory {
	return {
		memory: `Memory ${overrides.id}`,
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

function makeDoc(id: string, memories: GraphApiMemory[]): GraphApiDocument {
	return {
		id,
		title: `Doc ${id}`,
		summary: null,
		documentType: "text",
		createdAt: "2024-01-01",
		updatedAt: "2024-01-01",
		x: 0,
		y: 0,
		memories,
	}
}

describe("VersionChainIndex", () => {
	it("getChain returns null for version 1 memories (no chain)", () => {
		const idx = new VersionChainIndex()
		const doc = makeDoc("d1", [
			makeMem({ id: "m1", version: 1 }),
		])
		idx.rebuild([doc])
		// version <= 1 returns null per implementation
		expect(idx.getChain("m1")).toBeNull()
	})

	it("builds chain by walking parentMemoryId backwards then reversing", () => {
		const idx = new VersionChainIndex()
		const doc = makeDoc("d1", [
			makeMem({ id: "m1", version: 1 }),
			makeMem({ id: "m2", parentMemoryId: "m1", rootMemoryId: "m1", version: 2 }),
			makeMem({ id: "m3", parentMemoryId: "m2", rootMemoryId: "m1", version: 3 }),
		])
		idx.rebuild([doc])

		// Query from the latest (version 3) — walks back m3->m2->m1, reverses to [m1,m2,m3]
		const chain = idx.getChain("m3")
		expect(chain).not.toBeNull()
		expect(chain!.length).toBe(3)
		expect(chain!.map((e) => e.id)).toEqual(["m1", "m2", "m3"])
	})

	it("getChain from middle element walks back to root", () => {
		const idx = new VersionChainIndex()
		const doc = makeDoc("d1", [
			makeMem({ id: "m1", version: 1 }),
			makeMem({ id: "m2", parentMemoryId: "m1", rootMemoryId: "m1", version: 2 }),
			makeMem({ id: "m3", parentMemoryId: "m2", rootMemoryId: "m1", version: 3 }),
		])
		idx.rebuild([doc])

		// Query from m2 (version 2) — walks back m2->m1, reverses to [m1,m2]
		// Note: it doesn't walk forward to m3, only backward
		const chain = idx.getChain("m2")
		expect(chain).not.toBeNull()
		expect(chain!.length).toBe(2)
		expect(chain!.map((e) => e.id)).toEqual(["m1", "m2"])
	})

	it("caches chain results for all entries in the chain", () => {
		const idx = new VersionChainIndex()
		const doc = makeDoc("d1", [
			makeMem({ id: "m1", version: 1 }),
			makeMem({ id: "m2", parentMemoryId: "m1", rootMemoryId: "m1", version: 2 }),
		])
		idx.rebuild([doc])

		const chain1 = idx.getChain("m2")
		// After querying m2, m1 should also be cached (same chain object)
		const chain2 = idx.getChain("m1")
		// m1 is version 1, but it was cached as part of m2's chain
		expect(chain2).toBe(chain1) // same reference
	})

	it("getChain returns null for unknown ID", () => {
		const idx = new VersionChainIndex()
		idx.rebuild([makeDoc("d1", [makeMem({ id: "m1", version: 1 })])])
		expect(idx.getChain("nonexistent")).toBeNull()
	})

	it("handles empty documents array", () => {
		const idx = new VersionChainIndex()
		expect(() => idx.rebuild([])).not.toThrow()
		expect(idx.getChain("anything")).toBeNull()
	})

	it("rebuild clears previous chains (new array reference)", () => {
		const idx = new VersionChainIndex()
		const doc1 = makeDoc("d1", [
			makeMem({ id: "m1", version: 1 }),
			makeMem({ id: "m2", parentMemoryId: "m1", rootMemoryId: "m1", version: 2 }),
		])
		idx.rebuild([doc1])
		expect(idx.getChain("m2")).not.toBeNull()

		// Rebuild with different data (new array reference)
		const doc2 = makeDoc("d2", [makeMem({ id: "m3", version: 1 })])
		idx.rebuild([doc2])
		expect(idx.getChain("m2")).toBeNull()
		expect(idx.getChain("m1")).toBeNull()
	})

	it("rebuild skips if same array reference", () => {
		const idx = new VersionChainIndex()
		const docs = [makeDoc("d1", [
			makeMem({ id: "m1", version: 1 }),
			makeMem({ id: "m2", parentMemoryId: "m1", rootMemoryId: "m1", version: 2 }),
		])]
		idx.rebuild(docs)
		const chain1 = idx.getChain("m2")

		// Same reference — rebuild is a no-op
		idx.rebuild(docs)
		const chain2 = idx.getChain("m2")
		expect(chain2).toBe(chain1)
	})

	it("handles multiple independent chains across documents", () => {
		const idx = new VersionChainIndex()
		const docs = [
			makeDoc("d1", [
				makeMem({ id: "m1", version: 1 }),
				makeMem({ id: "m2", parentMemoryId: "m1", rootMemoryId: "m1", version: 2 }),
			]),
			makeDoc("d2", [
				makeMem({ id: "m3", version: 1 }),
				makeMem({ id: "m4", parentMemoryId: "m3", rootMemoryId: "m3", version: 2 }),
			]),
		]
		idx.rebuild(docs)

		const chain1 = idx.getChain("m2")
		const chain2 = idx.getChain("m4")
		expect(chain1).not.toBeNull()
		expect(chain2).not.toBeNull()
		expect(chain1!.map((e) => e.id)).toEqual(["m1", "m2"])
		expect(chain2!.map((e) => e.id)).toEqual(["m3", "m4"])
	})

	it("chain entries have correct fields", () => {
		const idx = new VersionChainIndex()
		const doc = makeDoc("d1", [
			makeMem({ id: "m1", version: 1, isForgotten: true, isLatest: false }),
			makeMem({ id: "m2", parentMemoryId: "m1", rootMemoryId: "m1", version: 2, isLatest: true }),
		])
		idx.rebuild([doc])

		const chain = idx.getChain("m2")
		expect(chain).not.toBeNull()
		expect(chain![0]).toEqual({
			id: "m1",
			version: 1,
			memory: "Memory m1",
			isForgotten: true,
			isLatest: false,
		})
		expect(chain![1]).toEqual({
			id: "m2",
			version: 2,
			memory: "Memory m2",
			isForgotten: false,
			isLatest: true,
		})
	})
})
