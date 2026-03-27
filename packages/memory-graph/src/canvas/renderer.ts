import type {
	DocumentNodeData,
	GraphEdge,
	GraphNode,
	GraphThemeColors,
	MemoryNodeData,
} from "../types"
import type { ViewportState } from "./viewport"

export interface RenderState {
	selectedNodeId: string | null
	hoveredNodeId: string | null
	highlightIds: Set<string>
	dimProgress: number
}

// Module-level reusable batch map – cleared each frame instead of reallocating
const edgeBatches = new Map<string, PreparedEdge[]>()

export function renderFrame(
	ctx: CanvasRenderingContext2D,
	nodes: GraphNode[],
	edges: GraphEdge[],
	viewport: ViewportState,
	width: number,
	height: number,
	state: RenderState,
	nodeMap: Map<string, GraphNode>,
	colors: GraphThemeColors,
): void {
	ctx.clearRect(0, 0, width, height)
	drawDocDocLines(ctx, nodes, viewport, width, height, colors)
	drawEdges(ctx, edges, viewport, width, height, state, nodeMap, colors)
	drawNodes(ctx, nodes, viewport, width, height, state, colors)
}

function drawDocDocLines(
	ctx: CanvasRenderingContext2D,
	nodes: GraphNode[],
	viewport: ViewportState,
	width: number,
	height: number,
	colors: GraphThemeColors,
): void {
	// Collect visible docs with screen positions
	const docs: { x: number; y: number }[] = []
	for (const n of nodes) {
		if (n.type !== "document") continue
		const s = viewport.worldToScreen(n.x, n.y)
		if (s.x > -100 && s.x < width + 100 && s.y > -100 && s.y < height + 100) {
			docs.push(s)
		}
	}
	if (docs.length < 2) return

	// Build spatial grid for O(n*k) nearest-neighbor instead of O(n^2)
	const CELL = 200
	const grid = new Map<string, number[]>()
	for (let i = 0; i < docs.length; i++) {
		const d = docs[i]!
		const key = `${Math.floor(d.x / CELL)},${Math.floor(d.y / CELL)}`
		let cell = grid.get(key)
		if (!cell) {
			cell = []
			grid.set(key, cell)
		}
		cell.push(i)
	}

	// For each doc, find 2 nearest from neighboring cells only
	ctx.strokeStyle = colors.edgeDocDoc
	ctx.lineWidth = 1
	ctx.globalAlpha = 0.3
	ctx.setLineDash([4, 6])
	ctx.beginPath()

	for (let i = 0; i < docs.length; i++) {
		const d = docs[i]!
		const cx = Math.floor(d.x / CELL)
		const cy = Math.floor(d.y / CELL)
		let best1 = -1
		let best2 = -1
		let dist1 = Number.POSITIVE_INFINITY
		let dist2 = Number.POSITIVE_INFINITY

		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				const cell = grid.get(`${cx + dx},${cy + dy}`)
				if (!cell) continue
				for (const j of cell) {
					if (j === i) continue
					const other = docs[j]!
					const ox = other.x - d.x
					const oy = other.y - d.y
					const dist = ox * ox + oy * oy
					if (dist < dist1) {
						best2 = best1
						dist2 = dist1
						best1 = j
						dist1 = dist
					} else if (dist < dist2) {
						best2 = j
						dist2 = dist
					}
				}
			}
		}

		if (best1 >= 0 && i < best1) {
			const b1 = docs[best1]!
			ctx.moveTo(d.x, d.y)
			ctx.lineTo(b1.x, b1.y)
		}
		if (best2 >= 0 && i < best2) {
			const b2 = docs[best2]!
			ctx.moveTo(d.x, d.y)
			ctx.lineTo(b2.x, b2.y)
		}
	}

	ctx.stroke()
	ctx.setLineDash([])
	ctx.globalAlpha = 1
}

function edgeStyle(
	edge: GraphEdge,
	colors: GraphThemeColors,
): { color: string; width: number } {
	if (edge.edgeType === "doc-memory")
		return { color: colors.edgeDocMemory, width: 1.5 }
	if (edge.edgeType === "version")
		return { color: colors.edgeVersion, width: 2 }
	if (edge.similarity >= 0.9) return { color: colors.edgeSimStrong, width: 2 }
	if (edge.similarity >= 0.8) return { color: colors.edgeSimMedium, width: 1.5 }
	return { color: colors.edgeSimWeak, width: 1 }
}

function batchKey(style: { color: string; width: number }): string {
	return `${style.color}|${style.width}`
}

interface PreparedEdge {
	startX: number
	startY: number
	endX: number
	endY: number
	connected: boolean
	style: { color: string; width: number }
	isVersion: boolean
	arrowSize: number
}

function drawEdges(
	ctx: CanvasRenderingContext2D,
	edges: GraphEdge[],
	viewport: ViewportState,
	width: number,
	height: number,
	state: RenderState,
	nodeMap: Map<string, GraphNode>,
	colors: GraphThemeColors,
): void {
	const margin = 100
	const hasDim = state.selectedNodeId !== null && state.dimProgress > 0

	const prepared: PreparedEdge[] = []

	for (const edge of edges) {
		// Zoom-based edge culling for similarity edges
		if (edge.edgeType === "similarity") {
			if (viewport.zoom < 0.3) continue
			if (viewport.zoom < 0.5 && edge.similarity < 0.9) continue
		}

		const src =
			typeof edge.source === "string" ? nodeMap.get(edge.source) : edge.source
		const tgt =
			typeof edge.target === "string" ? nodeMap.get(edge.target) : edge.target
		if (!src || !tgt) continue

		if (edge.edgeType === "doc-memory") {
			const mem = src.type === "memory" ? src : tgt
			if (mem.size * viewport.zoom < 3) continue
		}

		const s = viewport.worldToScreen(src.x, src.y)
		const t = viewport.worldToScreen(tgt.x, tgt.y)

		if (
			(s.x < -margin && t.x < -margin) ||
			(s.x > width + margin && t.x > width + margin) ||
			(s.y < -margin && t.y < -margin) ||
			(s.y > height + margin && t.y > height + margin)
		)
			continue

		const dx = t.x - s.x
		const dy = t.y - s.y
		const dist = Math.sqrt(dx * dx + dy * dy)
		if (dist < 1) continue

		const ux = dx / dist
		const uy = dy / dist
		const sr = src.size * viewport.zoom * 0.5
		const tr = tgt.size * viewport.zoom * 0.5

		let connected = true
		if (hasDim) {
			const srcId =
				typeof edge.source === "string" ? edge.source : edge.source.id
			const tgtId =
				typeof edge.target === "string" ? edge.target : edge.target.id
			connected =
				srcId === state.selectedNodeId || tgtId === state.selectedNodeId
		}

		prepared.push({
			startX: s.x + ux * sr,
			startY: s.y + uy * sr,
			endX: t.x - ux * tr,
			endY: t.y - uy * tr,
			connected,
			style: edgeStyle(edge, colors),
			isVersion: edge.edgeType === "version",
			arrowSize:
				edge.edgeType === "version" ? Math.max(6, 8 * viewport.zoom) : 0,
		})
	}

	// Reuse module-level batch map
	edgeBatches.clear()
	for (const e of prepared) {
		const dimKey = hasDim ? (e.connected ? "|c" : "|d") : ""
		const key = batchKey(e.style) + dimKey
		let batch = edgeBatches.get(key)
		if (!batch) {
			batch = []
			edgeBatches.set(key, batch)
		}
		batch.push(e)
	}

	ctx.setLineDash([])
	for (const [key, batch] of edgeBatches) {
		const first = batch[0]
		if (!first) continue
		const isDimmed = key.endsWith("|d")

		ctx.globalAlpha = isDimmed ? 1 - state.dimProgress * 0.8 : 1
		ctx.strokeStyle = first.style.color
		ctx.lineWidth = first.style.width

		ctx.beginPath()
		for (const e of batch) {
			ctx.moveTo(e.startX, e.startY)
			ctx.lineTo(e.endX, e.endY)
		}
		ctx.stroke()

		const versionEdges = batch.filter((e) => e.isVersion)
		if (versionEdges.length > 0) {
			ctx.fillStyle = first.style.color
			for (const e of versionEdges) {
				drawArrowHead(ctx, e.startX, e.startY, e.endX, e.endY, e.arrowSize)
			}
		}
	}

	ctx.globalAlpha = 1
}

function drawArrowHead(
	ctx: CanvasRenderingContext2D,
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	size: number,
): void {
	const angle = Math.atan2(toY - fromY, toX - fromX)
	ctx.beginPath()
	ctx.moveTo(toX, toY)
	ctx.lineTo(
		toX - size * Math.cos(angle - Math.PI / 6),
		toY - size * Math.sin(angle - Math.PI / 6),
	)
	ctx.lineTo(
		toX - size * Math.cos(angle + Math.PI / 6),
		toY - size * Math.sin(angle + Math.PI / 6),
	)
	ctx.closePath()
	ctx.fill()
}

function drawNodes(
	ctx: CanvasRenderingContext2D,
	nodes: GraphNode[],
	viewport: ViewportState,
	width: number,
	height: number,
	state: RenderState,
	colors: GraphThemeColors,
): void {
	const margin = 60
	const memDots: {
		x: number
		y: number
		r: number
		color: string
		dimmed: boolean
	}[] = []
	const docDots: { x: number; y: number; s: number }[] = []

	for (const node of nodes) {
		const screen = viewport.worldToScreen(node.x, node.y)
		const screenSize = node.size * viewport.zoom

		const cullSize = Math.max(screenSize, 2)
		if (
			screen.x + cullSize < -margin ||
			screen.x - cullSize > width + margin ||
			screen.y + cullSize < -margin ||
			screen.y - cullSize > height + margin
		)
			continue

		const isSelected = node.id === state.selectedNodeId
		const isHovered = node.id === state.hoveredNodeId
		const isHighlighted = state.highlightIds.has(node.id)

		if (screenSize < 8 && !isSelected && !isHovered && !isHighlighted) {
			if (node.type === "document") {
				docDots.push({ x: screen.x, y: screen.y, s: Math.max(3, screenSize) })
			} else {
				const md = node.data as MemoryNodeData
				memDots.push({
					x: screen.x,
					y: screen.y,
					r: Math.max(2, screenSize * 0.45),
					color: node.borderColor || colors.memStrokeDefault,
					dimmed: md.isLatest === false,
				})
			}
			continue
		}

		let alpha = 1
		if (state.selectedNodeId && state.dimProgress > 0 && !isSelected) {
			alpha = 1 - state.dimProgress * 0.7
		}
		ctx.globalAlpha = alpha

		if (node.type === "document") {
			drawDocumentNode(
				ctx,
				screen.x,
				screen.y,
				screenSize,
				node,
				isSelected,
				isHovered,
				isHighlighted,
				colors,
			)
		} else {
			drawMemoryNode(
				ctx,
				screen.x,
				screen.y,
				screenSize,
				node,
				isSelected,
				isHovered,
				isHighlighted,
				colors,
			)
		}

		if (isSelected || isHighlighted) {
			drawGlow(ctx, screen.x, screen.y, screenSize, node.type, colors)
		}
	}

	const dimAlpha =
		state.selectedNodeId && state.dimProgress > 0
			? 1 - state.dimProgress * 0.7
			: 1

	if (docDots.length > 0) {
		ctx.fillStyle = colors.docFill
		ctx.strokeStyle = colors.docStroke
		ctx.lineWidth = 1
		ctx.globalAlpha = dimAlpha
		for (const d of docDots) {
			const h = d.s * 0.5
			ctx.fillRect(d.x - h, d.y - h, d.s, d.s)
			ctx.strokeRect(d.x - h, d.y - h, d.s, d.s)
		}
	}

	if (memDots.length > 0) {
		// Draw normal (latest) memory dots
		const normalDots = memDots.filter((d) => !d.dimmed)
		const dimmedDots = memDots.filter((d) => d.dimmed)

		if (normalDots.length > 0) {
			ctx.globalAlpha = dimAlpha
			ctx.fillStyle = colors.memFill
			ctx.beginPath()
			for (const d of normalDots) {
				ctx.moveTo(d.x + d.r, d.y)
				ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
			}
			ctx.fill()

			ctx.lineWidth = 1.5
			const byColor = new Map<string, typeof normalDots>()
			for (const d of normalDots) {
				let batch = byColor.get(d.color)
				if (!batch) {
					batch = []
					byColor.set(d.color, batch)
				}
				batch.push(d)
			}
			for (const [color, batch] of byColor) {
				ctx.strokeStyle = color
				ctx.beginPath()
				for (const d of batch) {
					ctx.moveTo(d.x + d.r, d.y)
					ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
				}
				ctx.stroke()
			}
		}

		// Draw dimmed (superseded) memory dots at reduced opacity
		if (dimmedDots.length > 0) {
			ctx.globalAlpha = dimAlpha * 0.35
			ctx.fillStyle = colors.memFill
			ctx.beginPath()
			for (const d of dimmedDots) {
				ctx.moveTo(d.x + d.r, d.y)
				ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
			}
			ctx.fill()

			ctx.lineWidth = 1
			const byColor = new Map<string, typeof dimmedDots>()
			for (const d of dimmedDots) {
				let batch = byColor.get(d.color)
				if (!batch) {
					batch = []
					byColor.set(d.color, batch)
				}
				batch.push(d)
			}
			for (const [color, batch] of byColor) {
				ctx.strokeStyle = color
				ctx.beginPath()
				for (const d of batch) {
					ctx.moveTo(d.x + d.r, d.y)
					ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
				}
				ctx.stroke()
			}
		}
	}

	ctx.globalAlpha = 1
}

function drawDocumentNode(
	ctx: CanvasRenderingContext2D,
	sx: number,
	sy: number,
	size: number,
	node: GraphNode,
	isSelected: boolean,
	isHovered: boolean,
	isHighlighted: boolean,
	colors: GraphThemeColors,
): void {
	const half = size * 0.5
	const cornerR = 8 * (size / 50)

	ctx.fillStyle = colors.docFill
	ctx.strokeStyle =
		isSelected || isHighlighted
			? colors.accent
			: isHovered
				? colors.accent
				: colors.docStroke
	ctx.lineWidth = isSelected || isHighlighted ? 2 : 1
	roundRect(ctx, sx - half, sy - half, size, size, cornerR)
	ctx.fill()
	ctx.stroke()

	const innerSize = size * 0.72
	const innerHalf = innerSize * 0.5
	const innerR = 6 * (size / 50)
	ctx.fillStyle = colors.docInnerFill
	roundRect(ctx, sx - innerHalf, sy - innerHalf, innerSize, innerSize, innerR)
	ctx.fill()

	const iconSize = size * 0.35
	const docType =
		node.type === "document" ? (node.data as DocumentNodeData).type : "text"
	drawDocIcon(ctx, sx, sy, iconSize, docType || "text", colors)
}

function drawMemoryNode(
	ctx: CanvasRenderingContext2D,
	sx: number,
	sy: number,
	size: number,
	node: GraphNode,
	isSelected: boolean,
	isHovered: boolean,
	_isHighlighted: boolean,
	colors: GraphThemeColors,
): void {
	const memData = node.data as MemoryNodeData
	const isSuperseded = memData.isLatest === false
	const radius = size * 0.5

	// Dim superseded (non-latest) memory nodes
	if (isSuperseded && !isSelected && !isHovered) {
		const prevAlpha = ctx.globalAlpha
		ctx.globalAlpha = prevAlpha * 0.35
		ctx.fillStyle = colors.memFill
		drawHexagon(ctx, sx, sy, radius)
		ctx.fill()
		ctx.strokeStyle = node.borderColor || colors.memStrokeDefault
		ctx.lineWidth = 1
		ctx.setLineDash([3, 3])
		ctx.stroke()
		ctx.setLineDash([])
		ctx.globalAlpha = prevAlpha
		return
	}

	ctx.fillStyle = isHovered ? colors.memFillHover : colors.memFill
	drawHexagon(ctx, sx, sy, radius)
	ctx.fill()

	const borderColor = node.borderColor || colors.memStrokeDefault
	ctx.strokeStyle = isSelected ? colors.accent : borderColor
	ctx.lineWidth = isHovered ? 2 : 1.5
	ctx.stroke()
}

function drawGlow(
	ctx: CanvasRenderingContext2D,
	sx: number,
	sy: number,
	size: number,
	nodeType: "document" | "memory",
	colors: GraphThemeColors,
): void {
	ctx.strokeStyle = colors.glowColor
	ctx.lineWidth = 2
	ctx.setLineDash([3, 3])
	ctx.globalAlpha = 0.8

	if (nodeType === "document") {
		const glowSize = size * 1.15
		const half = glowSize * 0.5
		const r = 8 * (glowSize / 50)
		roundRect(ctx, sx - half, sy - half, glowSize, glowSize, r)
	} else {
		drawHexagon(ctx, sx, sy, size * 0.5 * 1.15)
	}

	ctx.stroke()
	ctx.setLineDash([])
	ctx.globalAlpha = 1
}

function drawHexagon(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	radius: number,
): void {
	ctx.beginPath()
	for (let i = 0; i < 6; i++) {
		const angle = (Math.PI / 3) * i - Math.PI / 6
		const x = cx + radius * Math.cos(angle)
		const y = cy + radius * Math.sin(angle)
		i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
	}
	ctx.closePath()
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	ctx.beginPath()
	ctx.moveTo(x + r, y)
	ctx.lineTo(x + w - r, y)
	ctx.arcTo(x + w, y, x + w, y + r, r)
	ctx.lineTo(x + w, y + h - r)
	ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
	ctx.lineTo(x + r, y + h)
	ctx.arcTo(x, y + h, x, y + h - r, r)
	ctx.lineTo(x, y + r)
	ctx.arcTo(x, y, x + r, y, r)
	ctx.closePath()
}

function drawDocIcon(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
	type: string,
	colors: GraphThemeColors,
): void {
	ctx.save()
	ctx.fillStyle = colors.iconColor
	ctx.strokeStyle = colors.iconColor
	ctx.lineWidth = Math.max(1, size / 12)
	ctx.lineCap = "round"
	ctx.lineJoin = "round"

	switch (type) {
		case "webpage":
		case "url":
			drawGlobeIcon(ctx, x, y, size)
			break
		case "pdf":
			drawTextLabel(ctx, x, y, size, "PDF", 0.35)
			break
		case "md":
		case "markdown":
			drawTextLabel(ctx, x, y, size, "MD", 0.3)
			break
		case "doc":
		case "docx":
			drawTextLabel(ctx, x, y, size, "DOC", 0.28)
			break
		case "csv":
			drawGridIcon(ctx, x, y, size)
			break
		case "json":
			drawBracesIcon(ctx, x, y, size)
			break
		case "notion":
		case "notion_doc":
			drawTextLabel(ctx, x, y, size, "N", 0.4)
			break
		case "google_doc":
		case "google_sheet":
		case "google_slide":
			drawTextLabel(ctx, x, y, size, "G", 0.4)
			break
		default:
			drawDocOutline(ctx, x, y, size)
			break
	}

	ctx.restore()
}

function drawTextLabel(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
	text: string,
	fontRatio: number,
): void {
	ctx.font = `bold ${size * fontRatio}px sans-serif`
	ctx.textAlign = "center"
	ctx.textBaseline = "middle"
	ctx.fillText(text, x, y)
}

function drawGlobeIcon(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
): void {
	const r = size * 0.4
	ctx.beginPath()
	ctx.arc(x, y, r, 0, Math.PI * 2)
	ctx.stroke()
	ctx.beginPath()
	ctx.ellipse(x, y, r * 0.4, r, 0, 0, Math.PI * 2)
	ctx.stroke()
	ctx.beginPath()
	ctx.moveTo(x - r, y)
	ctx.lineTo(x + r, y)
	ctx.stroke()
}

function drawGridIcon(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
): void {
	const w = size * 0.7
	const h = size * 0.7
	ctx.strokeRect(x - w / 2, y - h / 2, w, h)
	ctx.beginPath()
	ctx.moveTo(x, y - h / 2)
	ctx.lineTo(x, y + h / 2)
	ctx.moveTo(x - w / 2, y)
	ctx.lineTo(x + w / 2, y)
	ctx.stroke()
}

function drawBracesIcon(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
): void {
	const w = size * 0.6
	const h = size * 0.8
	ctx.beginPath()
	ctx.moveTo(x - w / 4, y - h / 2)
	ctx.quadraticCurveTo(x - w / 2, y - h / 3, x - w / 2, y)
	ctx.quadraticCurveTo(x - w / 2, y + h / 3, x - w / 4, y + h / 2)
	ctx.stroke()
	ctx.beginPath()
	ctx.moveTo(x + w / 4, y - h / 2)
	ctx.quadraticCurveTo(x + w / 2, y - h / 3, x + w / 2, y)
	ctx.quadraticCurveTo(x + w / 2, y + h / 3, x + w / 4, y + h / 2)
	ctx.stroke()
}

function drawDocOutline(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
): void {
	const w = size * 0.7
	const h = size * 0.85
	const fold = size * 0.2
	ctx.beginPath()
	ctx.moveTo(x - w / 2, y - h / 2)
	ctx.lineTo(x + w / 2 - fold, y - h / 2)
	ctx.lineTo(x + w / 2, y - h / 2 + fold)
	ctx.lineTo(x + w / 2, y + h / 2)
	ctx.lineTo(x - w / 2, y + h / 2)
	ctx.closePath()
	ctx.stroke()
	const sp = size * 0.15
	const lw = size * 0.4
	ctx.beginPath()
	ctx.moveTo(x - lw / 2, y - sp)
	ctx.lineTo(x + lw / 2, y - sp)
	ctx.moveTo(x - lw / 2, y)
	ctx.lineTo(x + lw / 2, y)
	ctx.moveTo(x - lw / 2, y + sp)
	ctx.lineTo(x + lw / 2, y + sp)
	ctx.stroke()
}
