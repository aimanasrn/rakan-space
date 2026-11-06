<?php

namespace Database\Seeders;

use App\Models\Approval\ApprovalRequest;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\Approvals\Approvals;
use App\Support\Timesheets\Timesheets;
use Carbon\CarbonImmutable;

/**
 * Fictional timesheets for Rakan Teknologi. Called from DemoSeeder after the
 * projects and reporting lines exist; goes through the real services.
 */
class TimesheetDemoSeeder
{
    /** @param array<string, User> $u */
    public function rakanTech(Organization $org, array $u): void
    {
        $website = Project::where('organization_id', $org->id)->where('name', 'Website Revamp')->firstOrFail();
        $mobile = Project::where('organization_id', $org->id)->where('name', 'Mobile App Beta')->firstOrFail();
        $task = fn (Project $p, string $title) => Task::where('project_id', $p->id)->where('title', $title)->value('id');
        $landing = $task($website, 'Build responsive landing page');
        $audit = $task($website, 'Accessibility audit');
        $sso = $task($mobile, 'Implement login with SSO');
        $homepage = $task($website, 'Finalise new homepage design');
        $about = $task($website, 'Write copy for About page');

        $thisWeek = Timesheets::currentWeek($org);
        $lastWeek = $thisWeek->subWeek();
        $twoWeeksAgo = $thisWeek->subWeeks(2);

        // Hafiz: an approved week, last week waiting for Priya, and this week in progress.
        $this->week($org, $u['hafiz'], $twoWeeksAgo, [
            [$website->id, $landing, [300, 360, 240, 300, 240], 'Landing page layout'],
            [$mobile->id, $sso, [180, 120, 240, 180, 240], 'OAuth flow'],
        ]);
        $this->decide($this->submit($org, $u['hafiz'], $twoWeeksAgo), $u['priya'], 'approve');

        $this->week($org, $u['hafiz'], $lastWeek, [
            [$website->id, $audit, [240, 180, 0, 120, 240], 'Keyboard navigation fixes'],
            [$mobile->id, $sso, [240, 300, 420, 360, 180], 'Token refresh'],
            [null, null, [0, 0, 60, 0, 0], 'Town hall'],
        ]);
        $this->submit($org, $u['hafiz'], $lastWeek);

        $this->week($org, $u['hafiz'], $thisWeek, [
            [$website->id, $landing, [240, 300, 0, 0, 0], null],
            [$mobile->id, $sso, [240, 180, 0, 0, 0], null],
        ], upTo: CarbonImmutable::now($org->timezone)->startOfDay());

        // Mei Ling: last week returned by Priya with a comment.
        $this->week($org, $u['meiling'], $lastWeek, [
            [$website->id, $homepage, [480, 480, 420, 0, 0], 'Mockups and sign-off'],
            [$website->id, $about, [0, 0, 60, 480, 420], 'First draft'],
        ]);
        $this->decide($this->submit($org, $u['meiling'], $lastWeek), $u['priya'], 'return',
            'Thursday has 8 hours on About copy but the task was only opened on Friday. Please check.');
    }

    /**
     * @param  list<array{0: int|null, 1: int|null, 2: list<int>, 3: string|null}>  $rows  project, task, minutes Mon→Fri, note
     */
    private function week(Organization $org, User $user, CarbonImmutable $week, array $rows, ?CarbonImmutable $upTo = null): void
    {
        $entries = [];
        foreach ($rows as [$projectId, $taskId, $minutes, $note]) {
            foreach ($minutes as $day => $m) {
                $date = $week->addDays($day);
                if ($m > 0 && (! $upTo || $date->lte($upTo))) {
                    $entries[] = ['project_id' => $projectId, 'task_id' => $taskId, 'work_date' => $date->toDateString(), 'minutes' => $m, 'note' => $note];
                }
            }
        }
        Timesheets::save($org, $user, $week, $entries);
    }

    private function submit(Organization $org, User $user, CarbonImmutable $week): ApprovalRequest
    {
        return ApprovalRequest::findOrFail(Timesheets::submit($org, $user, $week)->approval_request_id);
    }

    private function decide(ApprovalRequest $request, User $approver, string $decision, ?string $comment = null): void
    {
        Approvals::decide($request, $approver, $decision, $comment);
    }
}
