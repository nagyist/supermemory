/**
 * Memory Graph MCP App - Interactive force-directed graph visualization
 */
import {
	App,
	applyDocumentTheme,
	applyHostFonts,
	applyHostStyleVariables,
	type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import ForceGraph, { type LinkObject, type NodeObject } from "force-graph"
import {
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceRadial,
} from "d3-force-3d"
import "./global.css"
import "./mcp-app.css"

// =============================================================================
// Types
// =============================================================================
interface GraphApiMemory {
	id: string
	memory: string
	isStatic: boolean
	spaceId: string
	isLatest: boolean
	isForgotten: boolean
	forgetAfter: string | null
	forgetReason: string | null
	version: number
	parentMemoryId: string | null
	rootMemoryId: string | null
	createdAt: string
	updatedAt: string
	relation?: "updates" | "extends" | "derives" | null
	memoryRelations?: Record<string, "updates" | "extends" | "derives"> | null
}

interface GraphApiDocument {
	id: string
	title: string | null
	summary: string | null
	documentType: string
	createdAt: string
	updatedAt: string
	memories: GraphApiMemory[]
}

interface ToolResultData {
	containerTag?: string
	documents: GraphApiDocument[]
	totalCount: number
}

interface MemoryNode extends NodeObject {
	id: string
	nodeType: "memory"
	memory: string
	documentId: string
	isLatest: boolean
	isForgotten: boolean
	forgetAfter: string | null
	version: number
	parentMemoryId: string | null
	createdAt: string
	borderColor: string
}

interface DocumentNode extends NodeObject {
	id: string
	nodeType: "document"
	title: string
	summary: string | null
	docType: string
	createdAt: string
	memoryCount: number
}

type GraphNode = MemoryNode | DocumentNode

interface GraphLink extends LinkObject {
	source: string | GraphNode
	target: string | GraphNode
	edgeType: "derives" | "updates" | "extends"
}

// =============================================================================
// Constants
// =============================================================================
const MEMORY_BORDER = {
	forgotten: "#EF4444",
	expiring: "#F59E0B",
	recent: "#10B981",
	default: "#3B73B8",
}

const EDGE_COLORS = {
	dark: {
		derives: "#38BDF8",
		updates: "#A78BFA",
		extends: "#2DD4BF",
	},
	light: {
		derives: "#7DD3FC",
		updates: "#A78BFA",
		extends: "#5EEAD4",
	},
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const CLUSTER_SPREAD = 120

// =============================================================================
// State
// =============================================================================
let isDark = true
let selectedNode: GraphNode | null = null

// =============================================================================
// DOM References
// =============================================================================
const container = document.getElementById("graph")!
const popup = document.getElementById("popup")!
const popupType = document.getElementById("popup-type")!
const popupTitle = document.getElementById("popup-title")!
const popupContent = document.getElementById("popup-content")!
const popupMeta = document.getElementById("popup-meta")!
const loadingEl = document.getElementById("loading")!
const statsEl = document.getElementById("stats")!
const zoomInBtn = document.getElementById("zoom-in")!
const zoomOutBtn = document.getElementById("zoom-out")!
const fitBtn = document.getElementById("fit-btn")!

// =============================================================================
// Helpers
// =============================================================================
function getMemoryBorderColor(mem: GraphApiMemory): string {
	if (mem.isForgotten) return MEMORY_BORDER.forgotten
	if (mem.forgetAfter) {
		const msLeft = new Date(mem.forgetAfter).getTime() - Date.now()
		if (msLeft < SEVEN_DAYS_MS) return MEMORY_BORDER.expiring
	}
	const age = Date.now() - new Date(mem.createdAt).getTime()
	if (age < ONE_DAY_MS) return MEMORY_BORDER.recent
	return MEMORY_BORDER.default
}

/** Simple hash to get deterministic initial positions from doc ID */
function hashCode(s: string): number {
	let h = 0
	for (let i = 0; i < s.length; i++) {
		h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
	}
	return h
}

function initialPosition(id: string, spread: number): { x: number; y: number } {
	const h = hashCode(id)
	const angle = ((h & 0xffff) / 0xffff) * Math.PI * 2
	const radius = (((h >>> 16) & 0xffff) / 0xffff) * spread
	return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

function transformData(data: ToolResultData): {
	nodes: GraphNode[]
	links: GraphLink[]
} {
	const nodes: GraphNode[] = []
	const links: GraphLink[] = []
	const SPREAD = 50

	// Pre-populate all node IDs so edge targets are always resolvable
	// regardless of iteration order.
	const nodeIds = new Set<string>()
	for (const doc of data.documents) {
		nodeIds.add(doc.id)
		for (const mem of doc.memories) nodeIds.add(mem.id)
	}

	for (const doc of data.documents) {
		const pos = initialPosition(doc.id, SPREAD)
		nodes.push({
			id: doc.id,
			nodeType: "document",
			title: doc.title || "Untitled",
			summary: doc.summary,
			docType: doc.documentType,
			createdAt: doc.createdAt,
			memoryCount: doc.memories.length,
			x: pos.x,
			y: pos.y,
		} as DocumentNode)

		const memCount = doc.memories.length
		for (let i = 0; i < memCount; i++) {
			const mem = doc.memories[i]!
			const angle = (i / memCount) * 2 * Math.PI

			nodes.push({
				id: mem.id,
				nodeType: "memory",
				memory: mem.memory,
				documentId: doc.id,
				isLatest: mem.isLatest,
				isForgotten: mem.isForgotten,
				forgetAfter: mem.forgetAfter,
				version: mem.version,
				parentMemoryId: mem.parentMemoryId,
				createdAt: mem.createdAt,
				borderColor: getMemoryBorderColor(mem),
				x: pos.x + Math.cos(angle) * CLUSTER_SPREAD,
				y: pos.y + Math.sin(angle) * CLUSTER_SPREAD,
			} as MemoryNode)

			// Derives link (doc -> memory)
			links.push({ source: doc.id, target: mem.id, edgeType: "derives" })

			// Memory-to-memory relation edges from backend data.
			// Uses memoryRelations as primary source, falls back to parentMemoryId.
			// Keep in sync with packages/memory-graph/src/hooks/use-graph-data.ts
			let relations: Record<string, string> = {}
			if (
				// Defensive: data comes from structuredContent cast, may be unexpected type
				mem.memoryRelations &&
				typeof mem.memoryRelations === "object" &&
				Object.keys(mem.memoryRelations).length > 0
			) {
				relations = mem.memoryRelations
			} else if (mem.parentMemoryId) {
				relations = { [mem.parentMemoryId]: "updates" }
			}

			for (const [targetId, relationType] of Object.entries(relations)) {
				if (!nodeIds.has(targetId)) continue
				const edgeType =
					relationType === "updates" ||
					relationType === "extends" ||
					relationType === "derives"
						? relationType
						: "updates"
				links.push({ source: targetId, target: mem.id, edgeType })
			}
		}
	}

	return { nodes, links }
}

// =============================================================================
// Drawing
// =============================================================================
function drawHexagon(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
	strokeColor: string,
) {
	ctx.beginPath()
	for (let i = 0; i < 6; i++) {
		const angle = (Math.PI / 3) * i - Math.PI / 6
		const px = x + radius * Math.cos(angle)
		const py = y + radius * Math.sin(angle)
		if (i === 0) ctx.moveTo(px, py)
		else ctx.lineTo(px, py)
	}
	ctx.closePath()
	ctx.fillStyle = isDark ? "#0D2034" : "#E8F0FE"
	ctx.fill()
	ctx.strokeStyle = strokeColor
	ctx.lineWidth = 1.5
	ctx.stroke()
}

function drawDocumentNode(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
) {
	const half = size / 2
	// Outer rounded rect
	ctx.beginPath()
	ctx.roundRect(x - half, y - half, size, size, 3)
	ctx.fillStyle = isDark ? "#1B1F24" : "#F1F5F9"
	ctx.fill()
	ctx.strokeStyle = isDark ? "#2A2F36" : "#CBD5E1"
	ctx.lineWidth = 1.5
	ctx.stroke()

	// Inner icon area
	const iconSize = size * 0.5
	const iconHalf = iconSize / 2
	ctx.beginPath()
	ctx.roundRect(x - iconHalf, y - iconHalf, iconSize, iconSize, 2)
	ctx.fillStyle = isDark ? "#13161A" : "#E2E8F0"
	ctx.fill()
}

// =============================================================================
// Force Graph Setup
// =============================================================================
function getLinkColor(link: GraphLink): string {
	const palette = isDark ? EDGE_COLORS.dark : EDGE_COLORS.light
	return palette[link.edgeType] || palette["derives"]
}

const graph = new ForceGraph<GraphNode, GraphLink>(container)
	.nodeId("id")
	.nodeCanvasObject(
		(node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
			const x = node.x!
			const y = node.y!

			if (node.nodeType === "memory") {
				const mem = node as MemoryNode
				drawHexagon(ctx, x, y, 10, mem.borderColor)

				if (globalScale > 2) {
					const label = mem.memory.slice(0, 30)
					ctx.font = `${Math.max(4, 10 / globalScale)}px system-ui, sans-serif`
					ctx.fillStyle = isDark ? "#94a3b8" : "#64748b"
					ctx.textAlign = "center"
					ctx.textBaseline = "top"
					ctx.fillText(label, x, y + 12)
				}
			} else {
				const doc = node as DocumentNode
				drawDocumentNode(ctx, x, y, 22)

				if (globalScale > 1.2) {
					const label = (doc.title || "").slice(0, 25)
					ctx.font = `600 ${Math.max(4, 11 / globalScale)}px system-ui, sans-serif`
					ctx.fillStyle = isDark ? "#e2e8f0" : "#1e293b"
					ctx.textAlign = "center"
					ctx.textBaseline = "top"
					ctx.fillText(label, x, y + 14)
				}
			}
		},
	)
	.nodeCanvasObjectMode(() => "replace")
	.nodePointerAreaPaint(
		(node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
			ctx.fillStyle = color
			ctx.beginPath()
			ctx.arc(
				node.x!,
				node.y!,
				node.nodeType === "document" ? 12 : 11,
				0,
				Math.PI * 2,
			)
			ctx.fill()
		},
	)
	.linkWidth((link: GraphLink) => {
		if (link.edgeType === "updates") return 2
		if (link.edgeType === "extends") return 0.5
		return 1
	})
	.linkColor(getLinkColor)
	.linkLineDash((link: GraphLink) => {
		if (link.edgeType === "extends") return [4, 2]
		return null as unknown as number[]
	})
	.linkDirectionalArrowLength((link: GraphLink) =>
		link.edgeType === "updates" ? 4 : 0,
	)
	.linkDirectionalArrowRelPos(1)
	.onNodeClick(handleNodeClick)
	.onBackgroundClick(() => hidePopup())
	.d3Force(
		"charge",
		forceManyBody().strength((node: GraphNode) =>
			node.nodeType === "document" ? -15 : -200,
		),
	)
	.d3Force(
		"link",
		forceLink()
			.distance((l: GraphLink) => (l.edgeType === "derives" ? 40 : 80))
			.strength((l: GraphLink) => {
				if (l.edgeType === "derives") return 0.8
				if (l.edgeType === "updates") return 1.0
				return 0.15 // extends
			}),
	)
	.d3Force("collide", forceCollide(18))
	.d3Force("center", forceCenter())
	.d3Force("bound", forceRadial(60).strength(0.3))
	.d3VelocityDecay(0.4)
	.warmupTicks(50)
	.cooldownTime(3000)

// =============================================================================
// Resize
// =============================================================================
function handleResize() {
	const { width, height } = container.getBoundingClientRect()
	graph.width(width).height(height)
}
window.addEventListener("resize", handleResize)
handleResize()

// =============================================================================
// Popup
// =============================================================================
function handleNodeClick(node: GraphNode, event: MouseEvent) {
	if (selectedNode?.id === node.id) {
		hidePopup()
		return
	}
	selectedNode = node
	showPopup(node, event.clientX, event.clientY)
}

function showPopup(node: GraphNode, x: number, y: number) {
	if (node.nodeType === "document") {
		const doc = node as DocumentNode
		popupType.textContent = "Document"
		popupType.className = "document"
		popupTitle.textContent = doc.title
		popupContent.textContent = doc.summary || "No summary available"
		popupMeta.textContent = `${doc.memoryCount} memories \u00b7 ${doc.docType} \u00b7 ${new Date(doc.createdAt).toLocaleDateString()}`
	} else {
		const mem = node as MemoryNode
		const typeLabel = mem.isForgotten
			? "Forgotten"
			: mem.isLatest
				? "Latest"
				: `v${mem.version}`
		popupType.textContent = typeLabel
		popupType.className = `memory${mem.isForgotten ? " forgotten" : mem.isLatest ? " latest" : ""}`
		popupTitle.textContent =
			mem.memory.length > 120 ? `${mem.memory.slice(0, 120)}...` : mem.memory
		popupContent.textContent = mem.memory.length > 120 ? mem.memory : ""

		const statusParts: string[] = [`Version ${mem.version}`]
		if (mem.isForgotten) statusParts.push("Forgotten")
		else if (mem.forgetAfter)
			statusParts.push(
				`Expires ${new Date(mem.forgetAfter).toLocaleDateString()}`,
			)
		statusParts.push(new Date(mem.createdAt).toLocaleDateString())
		popupMeta.textContent = statusParts.join(" \u00b7 ")
	}

	popup.style.display = "block"

	const rect = popup.getBoundingClientRect()
	const gap = 15
	const left = x < window.innerWidth / 2 ? x + gap : x - rect.width - gap
	const top = y < window.innerHeight / 2 ? y + gap : y - rect.height - gap
	popup.style.left = `${Math.max(8, left)}px`
	popup.style.top = `${Math.max(8, top)}px`
}

function hidePopup() {
	popup.style.display = "none"
	selectedNode = null
}

// =============================================================================
// Controls
// =============================================================================
const ZOOM_FACTOR = 1.5
zoomInBtn.addEventListener("click", () =>
	graph.zoom(graph.zoom() * ZOOM_FACTOR, 200),
)
zoomOutBtn.addEventListener("click", () =>
	graph.zoom(graph.zoom() / ZOOM_FACTOR, 200),
)
fitBtn.addEventListener("click", () => graph.zoomToFit(400, 40))

document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") hidePopup()
})

// =============================================================================
// Theme
// =============================================================================
function applyTheme(theme: "light" | "dark") {
	isDark = theme === "dark"
	document.documentElement.setAttribute("data-theme", theme)
	graph.backgroundColor(isDark ? "#0f1419" : "#ffffff")
}

// Detect system theme
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)")
applyTheme(prefersDark.matches ? "dark" : "light")
prefersDark.addEventListener("change", (e) =>
	applyTheme(e.matches ? "dark" : "light"),
)

// =============================================================================
// MCP App SDK
// =============================================================================
const app = new App({ name: "Memory Graph", version: "1.0.0" })

app.ontoolinput = () => {
	loadingEl.style.display = "flex"
	statsEl.textContent = "Loading graph data..."
}

app.ontoolresult = (result: CallToolResult) => {
	loadingEl.style.display = "none"

	if (result.isError) {
		statsEl.textContent = "Error loading graph"
		return
	}

	const data = result.structuredContent as unknown as ToolResultData
	if (!data?.documents) {
		statsEl.textContent = "No graph data available"
		return
	}

	const { nodes, links } = transformData(data)
	const memCount = nodes.filter((n) => n.nodeType === "memory").length
	const docCount = nodes.filter((n) => n.nodeType === "document").length

	statsEl.textContent = `${docCount} docs \u00b7 ${memCount} memories \u00b7 ${links.length} connections`

	graph.graphData({ nodes, links })

	// Fit to view after layout stabilizes
	setTimeout(() => graph.zoomToFit(400, 40), 600)
}

app.ontoolcancelled = () => {
	loadingEl.style.display = "none"
	statsEl.textContent = "Cancelled"
}

function handleHostContext(ctx: McpUiHostContext) {
	if (ctx.theme) {
		applyDocumentTheme(ctx.theme)
		applyTheme(ctx.theme)
	}
	if (ctx.styles?.variables) {
		applyHostStyleVariables(ctx.styles.variables)
	}
	if (ctx.styles?.css?.fonts) {
		applyHostFonts(ctx.styles.css.fonts)
	}
	if (ctx.safeAreaInsets) {
		const { top, right, bottom, left } = ctx.safeAreaInsets
		document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`
	}
}

app.onhostcontextchanged = handleHostContext

app.onteardown = async () => ({})

app.onerror = console.error

// Connect to host
app.connect().then(() => {
	const ctx = app.getHostContext()
	if (ctx) handleHostContext(ctx)
})
