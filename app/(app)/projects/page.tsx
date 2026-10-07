import { requireUser } from "@/lib/auth/session";
import { listProjects, projectCounts } from "@/lib/repo/projects";
import { ProjectWorkspace } from "@/components/projects/ProjectWorkspace";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const { user } = await requireUser();
  const [projects, counts] = await Promise.all([listProjects(user.id), projectCounts(user.id)]);

  return <ProjectWorkspace initialProjects={projects} initialCounts={counts} />;
}
