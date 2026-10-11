import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LookupsResponse, TaskDto, TaskOptionsResponse, UserDto } from '@champ/shared';
import { callsTo, lookupsFixture, makeUser, mockApi } from '@/test/fixtures';
import { TaskForm } from './TaskFormPage';

const opt = (id: string, name: string, code: string | null = null) => ({ id, name, code });

const lookups: LookupsResponse = {
  ...lookupsFixture,
  activities: [
    { id: 'act-v-new', name: 'New installation', code: null, assetTypeId: 'at-vehicle' },
    { id: 'act-v-health', name: 'Health check', code: null, assetTypeId: 'at-vehicle' },
    { id: 'act-b-new', name: 'Battery install', code: null, assetTypeId: 'at-battery' },
  ],
  makeModels: [{ id: 'mm-ace', make: 'Tata', model: 'Ace' }],
  installationTypes: [opt('it-gps', 'GPS'), opt('it-can', 'GPS+CAN')],
  shiftTypes: [opt('sh-day', 'Day', 'DAY'), opt('sh-night', 'Night', 'NIGHT')],
  issuesReported: [opt('iss-1', 'Device not reporting')],
  clients: [
    {
      id: 'cl-zoom',
      name: 'Zoomcar',
      code: 'ZOOM',
      contactName: 'Priya Rao',
      contactPhone: '+91 98765 43210',
      contactEmail: 'priya@zoom.example',
      sites: [
        { id: 'site-blr', name: 'Bengaluru depot', locationId: 'loc-blr', lat: 12.9, lng: 77.6 },
        { id: 'site-pune', name: 'Pune yard', locationId: 'loc-pune', lat: 18.5, lng: 73.8 },
      ],
    },
    {
      id: 'cl-dlog',
      name: 'Demo Logistics',
      code: 'DLOG',
      contactName: 'Arvind Mehta',
      contactPhone: '+91 90000 20001',
      contactEmail: null,
      sites: [{ id: 'site-del', name: 'Delhi hub', locationId: 'loc-blr', lat: 28.5, lng: 77.2 }],
    },
  ],
};

const options: TaskOptionsResponse = {
  oes: [
    { id: 'oe-1', name: 'Esha Exec' },
    { id: 'oe-2', name: 'Farah Exec' },
  ],
  technicians: [
    { id: 'ot-ravi', name: 'Ravi Kumar', technicianType: 'PAYROLL', baseLocation: 'Bengaluru' },
    { id: 'ot-suresh', name: 'Suresh Patil', technicianType: 'THIRD_PARTY', baseLocation: 'Pune' },
  ],
};

const om = makeUser({ id: 'om-1', role: 'OM', name: 'Maya Manager' });
const oe = makeUser({ id: 'oe-1', role: 'OE', name: 'Esha Exec' });

function renderForm(actor: UserDto = om, task?: TaskDto) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[task ? `/tasks/${task.id}/edit` : '/tasks/new']}>
        <Routes>
          <Route path="/tasks/new" element={<TaskForm actor={actor} lookups={lookups} options={options} />} />
          <Route path="/tasks/:id/edit" element={<TaskForm actor={actor} lookups={lookups} options={options} task={task} />} />
          <Route path="/tasks/:id" element={<p>Task detail page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type User = ReturnType<typeof userEvent.setup>;
const combo = (name: string) => screen.getByRole('combobox', { name });

async function pick(user: User, name: string, option: string | RegExp) {
  await user.click(combo(name));
  await user.click(await screen.findByRole('option', { name: option }));
}

async function optionsOf(user: User, name: string) {
  await user.click(combo(name));
  const listbox = await screen.findByRole('listbox');
  const labels = within(listbox)
    .getAllByRole('option')
    .map((o) => o.textContent);
  await user.keyboard('{Escape}');
  return labels;
}

const csvFile = (text: string, name = 'vehicles.csv') => new File([text], name, { type: 'text/csv' });

async function fillValidTask(user: User) {
  await pick(user, 'Customer', /Zoomcar/);
  await pick(user, 'Site', 'Bengaluru depot');
  await pick(user, 'Operation executive', 'Esha Exec');
  await pick(user, 'Asset type', 'Vehicle');
  await pick(user, 'Activity', 'New installation');
  await pick(user, 'Vehicle make/model', 'Tata Ace');
  await pick(user, 'Installation type', 'GPS');
  fireEvent.change(screen.getByLabelText('Requested fitment date and time (IST)'), { target: { value: '2026-10-20T10:00' } });
  fireEvent.change(screen.getByLabelText('Fitment date and time (IST)'), { target: { value: '2026-10-21T10:30' } });
  await user.click(screen.getByRole('radio', { name: 'Day' }));
  await pick(user, 'Issue reported by client', 'Device not reporting');
}

describe('TaskForm — create', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('customer → site cascade, with POC prefill that keeps what the user typed', async () => {
    const user = userEvent.setup();
    mockApi({});
    renderForm();
    expect(combo('Site')).toBeDisabled();

    await pick(user, 'Customer', /Zoomcar/);
    expect(await optionsOf(user, 'Site')).toEqual(['Bengaluru depot', 'Pune yard']);
    expect(screen.getByLabelText('POC name')).toHaveValue('Priya Rao');
    expect(screen.getByLabelText('POC phone')).toHaveValue('+91 98765 43210');
    expect(screen.getByLabelText('POC email (optional)')).toHaveValue('priya@zoom.example');
    await pick(user, 'Site', 'Pune yard');

    // The user edits the POC name; switching customer keeps it but refreshes the untouched fields.
    await user.clear(screen.getByLabelText('POC name'));
    await user.type(screen.getByLabelText('POC name'), 'Anil');
    await pick(user, 'Customer', /Demo Logistics/);
    expect(screen.getByLabelText('POC name')).toHaveValue('Anil');
    expect(screen.getByLabelText('POC phone')).toHaveValue('+91 90000 20001');
    expect(screen.getByLabelText('POC email (optional)')).toHaveValue('');
    // The site of the previous customer is cleared; a customer with one site gets it preselected.
    expect(combo('Site')).toHaveTextContent('Delhi hub');
  });

  it('asset type → activity cascade; make/model only for vehicles; LAF5 by default', async () => {
    const user = userEvent.setup();
    mockApi({});
    renderForm();
    expect(combo('Device type')).toHaveTextContent('LAF5');
    expect(combo('Activity')).toBeDisabled();
    expect(screen.queryByRole('combobox', { name: 'Vehicle make/model' })).not.toBeInTheDocument();

    await pick(user, 'Asset type', 'Vehicle');
    expect(await optionsOf(user, 'Activity')).toEqual(['New installation', 'Health check']);
    expect(combo('Vehicle make/model')).toBeInTheDocument();
    await pick(user, 'Activity', 'Health check');

    await pick(user, 'Asset type', 'Battery');
    expect(screen.queryByRole('combobox', { name: 'Vehicle make/model' })).not.toBeInTheDocument();
    expect(combo('Activity')).toHaveTextContent('Select an activity');
    expect(await optionsOf(user, 'Activity')).toEqual(['Battery install']);
  });

  it('validates required fields and the make/model rule without calling the API', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({});
    renderForm();
    await user.clear(screen.getByLabelText('Number of vehicles'));
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('Choose a customer')).toBeInTheDocument();
    expect(screen.getByText('Choose a site')).toBeInTheDocument();
    expect(screen.getByText('Choose an operation executive')).toBeInTheDocument();
    expect(screen.getByText('Choose the fitment date and time')).toBeInTheDocument();
    expect(screen.getByText('Enter the number of vehicles')).toBeInTheDocument();
    expect(screen.getByText('Choose a shift type')).toBeInTheDocument();

    await pick(user, 'Asset type', 'Vehicle');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('Choose the vehicle make/model')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/tasks')).toHaveLength(0);
  });

  it('an OE has the operation executive locked to themselves', async () => {
    mockApi({});
    renderForm(oe);
    expect(combo('Operation executive')).toBeDisabled();
    expect(combo('Operation executive')).toHaveTextContent('Esha Exec');
    expect(screen.getByText('Tasks you create are yours.')).toBeInTheDocument();
  });

  it('technician type filters the technicians; picking a technician sets the type', async () => {
    const user = userEvent.setup();
    mockApi({});
    renderForm();
    expect(await optionsOf(user, 'Technician (optional)')).toEqual([
      'No technician (assign later)',
      'Ravi KumarPayroll · Bengaluru',
      'Suresh PatilThird party · Pune',
    ]);
    await user.click(screen.getByRole('radio', { name: 'Third party' }));
    expect(await optionsOf(user, 'Technician (optional)')).toEqual(['No technician (assign later)', 'Suresh PatilThird party · Pune']);

    await user.click(screen.getByRole('radio', { name: 'Any' }));
    await pick(user, 'Technician (optional)', /Ravi Kumar/);
    expect(screen.getByRole('radio', { name: 'Payroll' })).toBeChecked();
    // A type that doesn't match the chosen technician clears them.
    await user.click(screen.getByRole('radio', { name: 'Contractual' }));
    expect(combo('Technician (optional)')).toHaveTextContent('No technician (assign later)');
  });

  it('creates a task with a vehicle count: IST times become UTC and the page opens the new task', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ 'POST /api/tasks': { id: 'task-1', omId: 'OM-00001', counts: { total: 3 } } });
    renderForm();
    await fillValidTask(user);
    await user.clear(screen.getByLabelText('Number of vehicles'));
    await user.type(screen.getByLabelText('Number of vehicles'), '3');
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    expect(await screen.findByText('Task detail page')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/tasks')).toEqual([
      expect.objectContaining({
        clientId: 'cl-zoom',
        siteId: 'site-blr',
        pocName: 'Priya Rao',
        oeId: 'oe-1',
        technicianType: null,
        technicianId: null,
        assetTypeId: 'at-vehicle',
        activityId: 'act-v-new',
        deviceTypeId: 'dt-laf5',
        makeModelId: 'mm-ace',
        installationTypeId: 'it-gps',
        requestedAt: '2026-10-20T04:30:00.000Z',
        fitmentAt: '2026-10-21T05:00:00.000Z',
        shiftTypeId: 'sh-day',
        issueReportedId: 'iss-1',
        vehicles: { entry: 'COUNT', count: 3 },
      }),
    ]);
  });

  it('vehicle CSV: shows problems in the file, previews good rows and sends them', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ 'POST /api/tasks': { id: 'task-1', omId: 'OM-00001', counts: { total: 2 } } });
    renderForm();
    await fillValidTask(user);
    await user.click(screen.getByRole('radio', { name: 'Upload CSV' }));
    expect(screen.queryByLabelText('Number of vehicles')).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText('Vehicle CSV'), csvFile('name,colour\nx,red\n'));
    expect(await screen.findByTestId('vehicle-csv-errors')).toHaveTextContent('The header must have at least one of');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('Fix the problems in the vehicle CSV')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/tasks')).toHaveLength(0);

    await user.upload(
      screen.getByLabelText('Vehicle CSV'),
      csvFile('Registration_Number,chassis_number,old_device_id\nKA01AB1234,CH1,\n\n,CH2,OLD-9\n'),
    );
    expect(await screen.findByTestId('vehicle-csv-summary')).toHaveTextContent('vehicles.csv: 2 vehicle(s)');
    expect(screen.queryByTestId('vehicle-csv-errors')).not.toBeInTheDocument();
    const rows = within(screen.getByRole('table', { name: 'Vehicles from the CSV' })).getAllByTestId('vehicle-csv-row');
    expect(rows.map((r) => r.textContent)).toEqual(['1KA01AB1234CH1——', '2—CH2—OLD-9']);

    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/tasks')).toHaveLength(1));
    expect((callsTo(fetchMock, 'POST', '/api/tasks')[0] as { vehicles: unknown }).vehicles).toEqual({
      entry: 'CSV',
      rows: [
        { vehicleRegNo: 'KA01AB1234', chassisNo: 'CH1', assetNumber: null, oldDeviceId: null },
        { vehicleRegNo: null, chassisNo: 'CH2', assetNumber: null, oldDeviceId: 'OLD-9' },
      ],
    });
  });

  it('shows server field errors next to the fields', async () => {
    const user = userEvent.setup();
    mockApi({
      'POST /api/tasks': new Response(
        JSON.stringify({
          error: {
            code: 'INACTIVE_REFERENCE',
            message: 'Bengaluru depot is inactive',
            details: { fieldErrors: { siteId: ["Bengaluru depot is inactive and can't be chosen"] } },
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    });
    renderForm();
    await fillValidTask(user);
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText("Bengaluru depot is inactive and can't be chosen")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Please fix the highlighted fields.');
  });
});

describe('TaskForm — edit', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ref = (id: string, name: string, code: string | null = null, active = true) => ({ id, name, code, active });
  const task: TaskDto = {
    id: 'task-1',
    omId: 'OM-00007',
    oeTaskId: 'OE-00007',
    status: 'OPEN',
    taskType: ref('tt-ot', 'OT', 'OT'),
    client: ref('cl-zoom', 'Zoomcar', 'ZOOM'),
    site: { id: 'site-blr', name: 'Bengaluru depot', address: 'MG Road', lat: 12.9, lng: 77.6, active: true },
    location: { id: 'loc-blr', city: 'Bengaluru', state: 'Karnataka' },
    pocName: 'Priya Rao',
    pocPhone: '+91 98765 43210',
    pocEmail: null,
    oeId: 'oe-1',
    oe: { id: 'oe-1', name: 'Esha Exec', active: true },
    technicianType: null,
    assetType: ref('at-vehicle', 'Vehicle', 'VEHICLE'),
    activity: ref('act-v-new', 'New installation'),
    deviceType: ref('dt-laf5', 'LAF5', 'LAF5'),
    makeModel: { id: 'mm-ace', make: 'Tata', model: 'Ace', active: true },
    installationType: ref('it-gps', 'GPS'),
    requestedAt: '2026-10-20T04:30:00.000Z',
    fitmentAt: '2026-10-21T05:00:00.000Z',
    shiftType: ref('sh-early', 'Early morning', 'EARLY_MORNING', false),
    issueReported: ref('iss-1', 'Device not reporting'),
    gpsAddress: null,
    comments: null,
    vehicleEntry: 'COUNT',
    counts: { total: 4, assigned: 0, open: 4 },
    fitments: [],
    createdBy: { id: 'om-1', name: 'Maya Manager' },
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    permissions: { canEdit: true, canAssign: true, canDelete: true, canViewHistory: true },
  };

  it('prefills IST times, shows an inactive current value, hides vehicles and the technician, and PATCHes', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ 'PATCH /api/tasks/task-1': { ...task, omId: 'OM-00007' } });
    renderForm(om, task);
    expect(screen.getByRole('heading', { name: 'Edit OM-00007' })).toBeInTheDocument();
    expect(screen.getByLabelText('Fitment date and time (IST)')).toHaveValue('2026-10-21T10:30');
    expect(screen.getByRole('radio', { name: 'Early morning (inactive)' })).toBeChecked();
    expect(screen.getByTestId('vehicle-count-fixed')).toHaveTextContent('4 vehicle(s)');
    expect(screen.queryByRole('combobox', { name: 'Technician (optional)' })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('POC name'));
    await user.type(screen.getByLabelText('POC name'), 'Anil');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Task detail page')).toBeInTheDocument();
    const [body] = callsTo(fetchMock, 'PATCH', '/api/tasks/task-1') as Record<string, unknown>[];
    expect(body).toMatchObject({ pocName: 'Anil', shiftTypeId: 'sh-early', fitmentAt: '2026-10-21T05:00:00.000Z' });
    expect(body).not.toHaveProperty('vehicles');
    expect(body).not.toHaveProperty('technicianId');
  });
});
