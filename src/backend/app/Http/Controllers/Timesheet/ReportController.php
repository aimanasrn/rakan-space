<?php

namespace App\Http\Controllers\Timesheet;

use App\Http\Controllers\Controller;
use App\Models\Organization;
use App\Models\Timesheet\Timesheet;
use App\Support\Permissions;
use App\Support\Timesheets\Timesheets;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Hours from submitted timesheets (drafts never count). Members see sheets
 * they can view (their own, direct reports, ones they approve) plus all hours
 * on projects they manage. Timesheet admins see everything.
 */
class ReportController extends Controller
{
    public const GROUPS = ['project', 'member', 'task', 'week'];

    public function __invoke(Request $request, Organization $organization): JsonResponse|StreamedResponse
    {
        $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'group_by' => ['nullable', Rule::in(self::GROUPS)],
            'status' => ['nullable', Rule::in(['approved', 'submitted'])],
            'project_id' => ['nullable', 'integer'],
            'user_id' => ['nullable', 'integer'],
            'format' => ['nullable', Rule::in(['json', 'csv'])],
        ]);
        $from = CarbonImmutable::createFromFormat('!Y-m-d', $request->input('from'));
        $to = CarbonImmutable::createFromFormat('!Y-m-d', $request->input('to'));
        if ($from->diffInDays($to) > 366) {
            return response()->json(['message' => 'Choose a range of one year or less.', 'errors' => ['to' => ['Choose a range of one year or less.']]], 422);
        }

        $base = $this->scoped($request, $organization, $from, $to);

        if ($request->input('format') === 'csv') {
            return $this->csv($base, $organization, $from, $to);
        }

        $group = $request->input('group_by', 'project');
        $rows = $this->grouped(clone $base, $group);
        $total = (int) (clone $base)->sum('e.minutes');

        return response()->json(['data' => [
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'group_by' => $group,
            'total_minutes' => $total,
            'members' => (int) (clone $base)->distinct()->count('t.user_id'),
            'rows' => $rows,
        ]]);
    }

    private function scoped(Request $request, Organization $organization, CarbonImmutable $from, CarbonImmutable $to): Builder
    {
        $user = $request->user();
        $statuses = $request->input('status') === 'approved'
            ? [Timesheet::STATUS_APPROVED]
            : [Timesheet::STATUS_PENDING_APPROVAL, Timesheet::STATUS_APPROVED];

        $query = DB::table('timesheet_entries as e')
            ->join('timesheets as t', 't.id', '=', 'e.timesheet_id')
            ->where('e.organization_id', $organization->id)
            ->where('t.organization_id', $organization->id)
            ->whereIn('t.status', $statuses)
            ->whereBetween('e.work_date', [$from->toDateString(), $to->toDateString()])
            ->when($request->filled('project_id'), fn ($q) => $q->where('e.project_id', $request->integer('project_id')))
            ->when($request->filled('user_id'), fn ($q) => $q->where('t.user_id', $request->integer('user_id')));

        if (! Permissions::canAdministerTimesheets($user, $organization->id)) {
            $visible = Permissions::visibleTimesheetsQuery($user, $organization->id)->select('timesheets.id');
            $projects = Permissions::timesheetReportProjectIdsQuery($user, $organization->id);
            $query->where(fn ($q) => $q->whereIn('t.id', $visible)->orWhereIn('e.project_id', $projects));
        }

        return $query;
    }

    /** @return list<array{key: string, label: string, sublabel: string|null, minutes: int}> */
    private function grouped(Builder $query, string $group): array
    {
        $rows = match ($group) {
            'project' => $query
                ->selectRaw("e.project_id, coalesce(max(e.project_name), 'General') as label, sum(e.minutes) as minutes")
                ->groupBy('e.project_id')->orderByDesc('minutes')->limit(500)->get()
                ->map(fn ($r) => ['key' => 'p'.($r->project_id ?? 0), 'label' => $r->label, 'sublabel' => null, 'minutes' => (int) $r->minutes]),
            'task' => $query
                ->selectRaw("e.project_id, e.task_id, coalesce(max(e.task_title), 'No task') as label, coalesce(max(e.project_name), 'General') as sublabel, sum(e.minutes) as minutes")
                ->groupBy('e.project_id', 'e.task_id')->orderByDesc('minutes')->limit(500)->get()
                ->map(fn ($r) => ['key' => 'p'.($r->project_id ?? 0).'t'.($r->task_id ?? 0), 'label' => $r->label, 'sublabel' => $r->sublabel, 'minutes' => (int) $r->minutes]),
            'member' => $query->join('users as u', 'u.id', '=', 't.user_id')
                ->selectRaw('t.user_id, max(u.name) as label, max(u.job_title) as sublabel, sum(e.minutes) as minutes')
                ->groupBy('t.user_id')->orderByDesc('minutes')->limit(500)->get()
                ->map(fn ($r) => ['key' => 'u'.$r->user_id, 'label' => $r->label, 'sublabel' => $r->sublabel, 'minutes' => (int) $r->minutes]),
            'week' => $query
                ->selectRaw('t.week_start, sum(e.minutes) as minutes')
                ->groupBy('t.week_start')->orderBy('t.week_start')->limit(500)->get()
                ->map(fn ($r) => ['key' => 'w'.$r->week_start, 'label' => 'Week of '.CarbonImmutable::parse($r->week_start)->format('j M Y'), 'sublabel' => null, 'minutes' => (int) $r->minutes]),
        };

        return $rows->values()->all();
    }

    private function csv(Builder $query, Organization $organization, CarbonImmutable $from, CarbonImmutable $to): StreamedResponse
    {
        $query->join('users as u', 'u.id', '=', 't.user_id')
            ->select(['e.id', 'e.work_date', 'u.name as member', 'e.project_name', 'e.task_title', 'e.minutes', 't.status', 'e.note'])
            ->orderBy('e.work_date')->orderBy('u.name')->orderBy('e.id');
        $name = 'timesheets-'.$organization->slug.'-'.$from->toDateString().'-to-'.$to->toDateString().'.csv';

        return response()->streamDownload(function () use ($query) {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['Date', 'Member', 'Project', 'Task', 'Hours', 'Status', 'Note'], escape: '');
            $query->chunk(1000, function ($rows) use ($out) {
                foreach ($rows as $r) {
                    fputcsv($out, array_map(self::cell(...), [
                        $r->work_date, $r->member, $r->project_name ?? 'General', $r->task_title ?? '',
                        number_format($r->minutes / 60, 2, '.', ''), $r->status === Timesheet::STATUS_APPROVED ? 'Approved' : 'Pending approval', $r->note ?? '',
                    ]), escape: '');
                }
            });
            fclose($out);
        }, $name, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /** Stops spreadsheet apps from running text as a formula. */
    private static function cell(string $value): string
    {
        return preg_match('/^[=+\-@\t\r]/', $value) && ! is_numeric($value) ? "'".$value : $value;
    }
}
