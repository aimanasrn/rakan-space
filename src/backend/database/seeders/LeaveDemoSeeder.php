<?php

namespace Database\Seeders;

use App\Models\Approval\ApprovalRequest;
use App\Models\Leave\LeaveRequest;
use App\Models\Leave\LeaveType;
use App\Models\Organization;
use App\Models\User;
use App\Support\Approvals\Approvals;
use App\Support\Leave\Leaves;
use Carbon\CarbonImmutable;

/**
 * Fictional leave for Rakan Teknologi, so the leave calendar has people on it.
 * Called from DemoSeeder after the reporting lines exist; goes through the
 * real services (Priya approves Hafiz and Mei Ling, Aisyah approves Priya and Daniel).
 */
class LeaveDemoSeeder
{
    /** @param array<string, User> $u */
    public function rakanTech(Organization $org, array $u): void
    {
        $type = fn (string $key) => LeaveType::where('organization_id', $org->id)->where('key', $key)->value('id');
        Leaves::types($org);

        // Monday of this week; stay inside one calendar year (balances are yearly).
        $monday = Leaves::today($org)->startOfWeek(CarbonImmutable::MONDAY);
        if ($monday->addWeeks(3)->year !== $monday->year) {
            $monday = $monday->subWeeks(4);
        }
        $day = fn (int $week, int $weekday) => $monday->addWeeks($week)->addDays($weekday)->toDateString();

        // Approved
        $this->approve($org, $this->apply($org, $u['hafiz'], $type('annual'), $day(1, 0), $day(1, 2), 'Family trip to Langkawi'), $u['priya'], 'Enjoy the break!');
        $this->approve($org, $this->apply($org, $u['meiling'], $type('medical'), $day(0, 1), $day(0, 1), 'Clinic visit'), $u['priya']);
        $this->approve($org, $this->apply($org, $u['daniel'], $type('business_travel'), $day(1, 2), $day(1, 4), 'Vendor visit in Penang'), $u['aisyah']);
        $this->approve($org, $this->apply($org, $u['priya'], $type('training'), $day(2, 0), $day(2, 1), 'AWS Summit'), $u['aisyah']);
        $this->approve($org, $this->apply($org, $u['meiling'], $type('annual'), $day(2, 4), $day(2, 4), null, 'am'), $u['priya']);

        // Waiting for Priya
        $this->apply($org, $u['hafiz'], $type('annual'), $day(3, 3), $day(3, 4), 'Hari Raya open house');
    }

    private function apply(Organization $org, User $user, int $typeId, string $start, string $end, ?string $reason, string $halfDay = 'none'): LeaveRequest
    {
        return Leaves::apply($org, $user, [
            'leave_type_id' => $typeId, 'start_date' => $start, 'end_date' => $end, 'half_day' => $halfDay, 'reason' => $reason,
        ]);
    }

    private function approve(Organization $org, LeaveRequest $leave, User $approver, ?string $comment = null): void
    {
        $request = ApprovalRequest::where('organization_id', $org->id)->findOrFail($leave->approval_request_id);
        Approvals::decide($request, $approver, 'approve', $comment);
    }
}
