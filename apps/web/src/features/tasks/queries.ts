import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignFitmentsInput,
  BulkImportInput,
  BulkImportResponse,
  BulkPreviewResponse,
  Paginated,
  TaskDto,
  TaskListItemDto,
  TaskOptionsResponse,
  UpdateFitmentInput,
} from '@champ/shared';
import { api, apiDownload, apiUpload } from '@/lib/api';
import { saveBlob } from '@/lib/download';

export const tasksKeys = {
  all: ['tasks'] as const,
  list: (query: TaskListParams) => ['tasks', 'list', query] as const,
  detail: (id: string) => ['tasks', 'detail', id] as const,
  options: ['tasks', 'options'] as const,
};

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
