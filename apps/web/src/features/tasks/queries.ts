import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveFitmentsResponse,
  AssignFitmentsInput,
  BulkImportInput,
  BulkImportResponse,
  BulkPreviewResponse,
  DashboardSummaryDto,
  Paginated,
  TaskDto,
  TaskEventDto,
  TaskHistoryResponse,
  TaskListItemDto,
  TaskOptionsResponse,
  TransitionInput,
  TransitionResponse,
  UpdateFitmentInput,
  WorkflowFitmentItemDto,
} from '@champ/shared';
import { api, apiDownload, apiUpload } from '@/lib/api';
import { saveBlob } from '@/lib/download';

export const tasksKeys = {
  all: ['tasks'] as const,
  list: (query: TaskListParams) => ['tasks', 'list', query] as const,
  detail: (id: string) => ['tasks', 'detail', id] as const,
  options: ['tasks', 'options'] as const,
  workflow: (list: WorkflowListName, query: TaskListParams) => ['tasks', 'workflow', list, query] as const,
  history: (id: string) => ['tasks', 'history', id] as const,
  events: (id: string) => ['tasks', 'events', id] as const,
  summary: ['tasks', 'summary'] as const,
};

/** The F05 fitment lists (`GET /fitments/<name>`). */
export type WorkflowListName = 'awaiting-approval' | 'reopened' | 'faulty';

/** `GET /tasks` query string (see `listTasksQuerySchema`); empty values are left out. */
export type TaskListParams = Record<string, string | number | undefined>;

export function useTasks(query: TaskListParams) {
  return useQuery({
    queryKey: tasksKeys.list(query),
    queryFn: () => api<Paginated<TaskListItemDto>>('/tasks', { query }),
    placeholderData: keepPreviousData,
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: tasksKeys.detail(id ?? ''),
    queryFn: () => api<TaskDto>(`/tasks/${id}`),
    enabled: !!id,
  });
}

/** OEs and technicians for the task form and the list filters. */
export function useTaskOptions() {
  return useQuery({
    queryKey: tasksKeys.options,
    queryFn: () => api<TaskOptionsResponse>('/tasks/options'),
    staleTime: 5 * 60_000,
  });
}

/** The create/edit body as the form sends it (the API validates and normalises it again). */
export type TaskBody = Record<string, unknown>;

function useTaskMutation<V>(mutationFn: (vars: V) => Promise<TaskDto>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (task) => {
      queryClient.setQueryData(tasksKeys.detail(task.id), task);
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] });
    },
  });
}

export const useCreateTask = () => useTaskMutation((body: TaskBody) => api<TaskDto>('/tasks', { method: 'POST', body }));

export const useUpdateTask = (id: string) =>
  useTaskMutation((body: TaskBody) => api<TaskDto>(`/tasks/${id}`, { method: 'PATCH', body }));

export const useUpdateFitment = (taskId: string) =>
  useTaskMutation(({ fitmentId, body }: { fitmentId: string; body: UpdateFitmentInput }) =>
    api<TaskDto>(`/tasks/${taskId}/fitments/${fitmentId}`, { method: 'PATCH', body }),
  );

export const useAssignFitments = (taskId: string) =>
  useTaskMutation((body: AssignFitmentsInput) => api<TaskDto>(`/tasks/${taskId}/assign`, { method: 'POST', body }));

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: tasksKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] });
    },
  });
}

// --- Downloads and bulk upload ---

/** Downloads a file from the API (e.g. `/tasks/export?…`) and saves it under the server's file name. */
export async function downloadFile(path: string, fallbackName: string) {
  const { blob, filename } = await apiDownload(path);
  saveBlob(blob, filename ?? fallbackName);
}

export const downloadBulkSample = () => downloadFile('/tasks/bulk/sample', 'champ-bulk-tasks-sample.csv');

export function previewBulk(file: File) {
  const form = new FormData();
  form.append('file', file);
  return apiUpload<BulkPreviewResponse>('/tasks/bulk/preview', form);
}

export function useImportBulk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkImportInput) => api<BulkImportResponse>('/tasks/bulk/import', { method: 'POST', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: tasksKeys.all }),
  });
}

// --- Workflow (F05) ---

/** After any workflow change: refresh every task query (detail, lists, workflow lists, history). */
export function useInvalidateTasks() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: tasksKeys.all });
}

/** `POST /fitments/:fid/transitions` (Verify, Final approve, Reopen on the web). */
export function useFitmentTransition() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ fitmentId, body }: { fitmentId: string; body: TransitionInput }) =>
      api<TransitionResponse>(`/fitments/${fitmentId}/transitions`, { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

/** `POST /fitments/approve`: bulk final approve (OM/SA). */
export function useApproveFitments() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (fitmentIds: string[]) =>
      api<ApproveFitmentsResponse>('/fitments/approve', { method: 'POST', body: { fitmentIds } }),
    onSuccess: invalidate,
  });
}

export function useWorkflowList(list: WorkflowListName, query: TaskListParams) {
  return useQuery({
    queryKey: tasksKeys.workflow(list, query),
    queryFn: () => api<Paginated<WorkflowFitmentItemDto>>(`/fitments/${list}`, { query }),
    placeholderData: keepPreviousData,
  });
}

export function useTaskHistory(id: string) {
  return useQuery({ queryKey: tasksKeys.history(id), queryFn: () => api<TaskHistoryResponse>(`/tasks/${id}/history`) });
}

export function useTaskEvents(id: string) {
  return useQuery({
    queryKey: tasksKeys.events(id),
    queryFn: () => api<{ items: TaskEventDto[] }>(`/tasks/${id}/events`),
  });
}

export const downloadTaskEvents = (id: string, omId: string) =>
  downloadFile(`/tasks/${id}/events?format=csv`, `champ-${omId}-events.csv`);

/** `GET /tasks/summary`: the role-aware dashboard counts (CR-03). Only for task viewers. */
export function useTaskSummary(enabled: boolean) {
  return useQuery({ queryKey: tasksKeys.summary, queryFn: () => api<DashboardSummaryDto>('/tasks/summary'), enabled });
}
