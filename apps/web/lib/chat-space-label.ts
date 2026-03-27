import { DEFAULT_PROJECT_ID } from "@lib/constants"
import type { ContainerTagListType } from "@lib/types"

/** Label for the space sent as chat `metadata.projectId` (container tag). */
export function getChatSpaceDisplayLabel(options: {
	selectedProject: string
	allProjects: ContainerTagListType[]
}): string {
	const { selectedProject, allProjects } = options
	if (selectedProject === DEFAULT_PROJECT_ID) {
		return "My Space"
	}
	const name = allProjects.find((p) => p.containerTag === selectedProject)?.name
	return name?.trim() || selectedProject
}
