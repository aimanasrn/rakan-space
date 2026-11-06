<?php

namespace Database\Seeders;

use App\Enums\Role;
use App\Models\AppAccessRequest;
use App\Models\Conversation;
use App\Models\LauncherApp;
use App\Models\Organization;
use App\Models\OrganizationMembership;
use App\Models\Project;
use App\Models\User;
use App\Models\UserAppPin;
use App\Models\UserNotification;
use App\Support\ActivityLog;
use App\Support\AppCatalog;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Fictional demo data: two separate organisations to demonstrate isolation.
 * All accounts use the password "password". Do not run in production.
 */
class DemoSeeder extends Seeder
{
    private array $users = [];

    public function run(): void
    {
        if (app()->isProduction()) {
            $this->command?->error('Refusing to seed demo data in production.');

            return;
        }

        $people = [
            'aisyah' => ['Aisyah Rahman', 'aisyah@rakantech.test', 'Chief Executive Officer'],
            'daniel' => ['Daniel Lim', 'daniel@rakantech.test', 'Head of Operations'],
            'priya' => ['Priya Nair', 'priya@rakantech.test', 'Engineering Manager'],
            'hafiz' => ['Hafiz Ismail', 'hafiz@rakantech.test', 'Software Engineer'],
            'meiling' => ['Tan Mei Ling', 'meiling@rakantech.test', 'Product Designer'],
            'farah' => ['Farah Kamal', 'farah@kopikita.test', 'Founder'],
            'zul' => ['Zulkifli Osman', 'zul@kopikita.test', 'Outlet Manager'],
            'siti' => ['Siti Nurhaliza Yusof', 'siti@kopikita.test', 'Barista Lead'],
        ];
        foreach ($people as $key => [$name, $email, $title]) {
            $this->users[$key] = User::updateOrCreate(['email' => $email], [
                'name' => $name, 'job_title' => $title, 'password' => Hash::make('password'),
            ]);
            $this->users[$key]->forceFill(['email_verified_at' => now()])->save();
        }

        $this->seedRakanTech();
        $this->seedKopiKita();
    }

    private function seedRakanTech(): void
    {
        $u = $this->users;
        $org = $this->organization('Rakan Teknologi Sdn Bhd', 'rakan-tech', $u['aisyah'], [
            'description' => 'A fictional software studio in Kuala Lumpur.', 'industry' => 'Software',
        ]);
        $this->members($org, [
            [$u['aisyah'], Role::Owner], [$u['daniel'], Role::Admin], [$u['priya'], Role::Manager],
            [$u['hafiz'], Role::Staff], [$u['meiling'], Role::Staff],
        ]);

        $eng = $org->departments()->create(['name' => 'Engineering', 'description' => 'Product engineering']);
        $ops = $org->departments()->create(['name' => 'Operations', 'description' => 'People, finance and admin']);
        $design = $org->departments()->create(['name' => 'Design']);
        $this->department($org, $eng, [$u['priya'], $u['hafiz']]);
        $this->department($org, $ops, [$u['daniel'], $u['aisyah']]);
        $this->department($org, $design, [$u['meiling']]);

        // Channels
        $general = $this->channel($org, 'general', 'public', 'Company-wide conversation', $u['aisyah'], array_values($u));
        $engineering = $this->channel($org, 'engineering', 'public', 'Builds, releases and code reviews', $u['priya'], [$u['priya'], $u['hafiz'], $u['meiling']]);
        $leadership = $this->channel($org, 'leadership', 'private', 'Leadership team only', $u['aisyah'], [$u['aisyah'], $u['daniel'], $u['priya']]);
        $this->channel($org, 'random', 'public', 'Makan spots, memes and weekend plans', $u['daniel'], [$u['daniel'], $u['hafiz'], $u['meiling']]);

        $this->messages($org, $general, [
            [$u['aisyah'], 'Selamat pagi semua! Welcome to RakanSpace — our one place for chat, projects and announcements.'],
            [$u['daniel'], 'Reminder: the office will be closed on Friday for maintenance. Please work from home.'],
            [$u['meiling'], 'Noted, thanks Daniel 🙏'],
            [$u['hafiz'], 'Is the town hall still on Wednesday at 3pm?'],
            [$u['aisyah'], 'Yes — Wednesday 3pm in the main meeting room, and online for remote folks.'],
        ]);
        $this->messages($org, $engineering, [
            [$u['priya'], 'Sprint 14 starts today. Focus: website revamp landing pages and the mobile beta login flow.'],
            [$u['hafiz'], 'I will pick up the API rate limiting task.'],
            [$u['meiling'], 'Updated hero designs are attached to the website task.'],
            [$u['priya'], '@Hafiz Ismail please review the staging deploy before 5pm.', [$u['hafiz']->id]],
        ]);
        $this->messages($org, $leadership, [
            [$u['aisyah'], 'Draft budget for next quarter is ready for review.'],
            [$u['daniel'], 'I will go through the hiring plan section tonight.'],
        ]);

        $dm = $this->direct($org, $u['priya'], $u['hafiz']);
        $this->messages($org, $dm, [
            [$u['priya'], 'Hey Hafiz, do you have time for a quick 1:1 tomorrow?'],
            [$u['hafiz'], 'Sure, 10am works for me.'],
        ]);

        // Projects
        $website = $this->project($org, 'Website Revamp', 'Refresh the corporate website with new branding, faster pages and a clearer contact flow.',
            'active', Project::VISIBILITY_ORGANIZATION, $u['priya'], [$u['hafiz'], $u['meiling']], -20, 25);
        $mobile = $this->project($org, 'Mobile App Beta', 'Ship the first beta of the staff mobile app to 50 pilot users.',
            'active', Project::VISIBILITY_RESTRICTED, $u['priya'], [$u['hafiz']], -10, 40);
        $office = $this->project($org, 'Office Move 2027', 'Plan and execute the move to the new Bangsar South office.',
            'planning', Project::VISIBILITY_RESTRICTED, $u['daniel'], [$u['aisyah']], 5, 90);

        $this->tasks($org, $website, $u['priya'], [
            ['Finalise new homepage design', 'done', 'high', $u['meiling'], -6, ['Wireframes', 'High-fidelity mockups', 'Stakeholder sign-off']],
            ['Build responsive landing page', 'in_progress', 'high', $u['hafiz'], 3, ['Hero section', 'Feature grid', 'Contact form']],
            ['Write copy for About page', 'todo', 'medium', $u['meiling'], 7, []],
            ['Set up analytics events', 'todo', 'low', null, 12, []],
            ['Accessibility audit', 'in_review', 'urgent', $u['hafiz'], -1, ['Keyboard navigation', 'Colour contrast']],
            ['Migrate blog posts', 'todo', 'medium', $u['hafiz'], -3, []],
        ]);
        $this->tasks($org, $mobile, $u['priya'], [
            ['Implement login with SSO', 'in_progress', 'urgent', $u['hafiz'], 1, ['OAuth flow', 'Token refresh']],
            ['Recruit 50 pilot users', 'todo', 'medium', $u['priya'], 10, []],
            ['API rate limiting', 'done', 'high', $u['hafiz'], -4, []],
        ]);
        $this->tasks($org, $office, $u['daniel'], [
            ['Shortlist moving vendors', 'todo', 'medium', $u['daniel'], 14, []],
            ['Floor plan review with landlord', 'todo', 'high', $u['aisyah'], 20, []],
        ]);

        // Calendar
        $this->event($org, 'Town hall', 'Quarterly update from the leadership team.', 'Main meeting room', null, 2, 15, 60, 'everyone', $u['aisyah'], []);
        $this->event($org, 'Sprint 14 planning', null, null, 'https://meet.example.com/sprint-14', 1, 10, 45, 'participants', $u['priya'], [$u['hafiz'], $u['meiling']]);
        $this->event($org, 'Design review: homepage', null, 'Studio', null, 4, 14, 30, 'participants', $u['meiling'], [$u['priya']]);
        $this->event($org, 'Budget review', null, 'CEO office', null, 6, 11, 60, 'participants', $u['aisyah'], [$u['daniel']]);

        // Announcements
        $a1 = $org->announcements()->create([
            'author_id' => $u['aisyah']->id, 'title' => 'Welcome to RakanSpace',
            'body' => "We are moving team chat, projects and announcements into RakanSpace.\n\nPlease update your profile photo and job title, and join the channels relevant to your work.",
            'audience' => 'organization', 'requires_acknowledgement' => true, 'pinned_at' => now(),
        ]);
        $a1->acknowledgements()->create(['user_id' => $u['daniel']->id, 'acknowledged_at' => now()]);
        $org->announcements()->create([
            'author_id' => $u['priya']->id, 'title' => 'Code freeze next Thursday',
            'body' => 'Engineering: please merge all release candidates by Wednesday 6pm. Only hotfixes after that.',
            'audience' => 'department', 'department_id' => $eng->id,
        ]);
        $org->announcements()->create([
            'author_id' => $u['daniel']->id, 'title' => 'New leave policy effective next month',
            'body' => 'The updated leave policy has been shared by email. Reach out to Operations with any questions.',
            'audience' => 'organization',
        ]);

        // Some persisted notifications so the bell is not empty on first login.
        $this->notify($org, $u['hafiz'], 'task.assigned', 'Priya Nair assigned you "Implement login with SSO"', '/projects/'.$mobile->id, $u['priya']);
        $this->notify($org, $u['hafiz'], 'mention', 'Priya Nair mentioned you in #engineering', '/chat/'.$engineering->id, $u['priya']);
        $this->notify($org, $u['meiling'], 'announcement', 'New announcement: Welcome to RakanSpace', '/announcements', $u['aisyah']);

        // Reporting lines
        $this->reportsTo($org, ['daniel' => 'aisyah', 'priya' => 'aisyah', 'hafiz' => 'priya', 'meiling' => 'priya']);

        // App launcher
        $this->launcher($org, $u['aisyah'], [
            'hafiz' => ['project', 'timesheet'],
            'priya' => ['project', 'approval', 'timesheet'],
            'aisyah' => ['approval', 'opportunity'],
        ]);
        $checkin = LauncherApp::where('key', 'checkin')->first();
        AppAccessRequest::create([
            'organization_id' => $org->id, 'app_id' => $checkin->id, 'user_id' => $u['hafiz']->id,
            'note' => 'For client-site visits with the Mobile App Beta pilot users.',
        ]);

        // Forms and approvals (needs the reporting lines above).
        (new FormApprovalDemoSeeder)->rakanTech($org, $this->users);
        (new TimesheetDemoSeeder)->rakanTech($org, $this->users);
        (new HelpdeskDemoSeeder)->rakanTech($org, $this->users);
    }

    private function seedKopiKita(): void
    {
        $u = $this->users;
        $org = $this->organization('Kopi Kita Trading', 'kopi-kita', $u['farah'], [
            'description' => 'A fictional chain of neighbourhood coffee shops.', 'industry' => 'Food & beverage',
        ]);
        // Daniel is an Admin at Rakan Teknologi but only Staff here.
        $this->members($org, [[$u['farah'], Role::Owner], [$u['zul'], Role::Manager], [$u['siti'], Role::Staff], [$u['daniel'], Role::Staff]]);

        $outlets = $org->departments()->create(['name' => 'Outlets']);
        $this->department($org, $outlets, [$u['zul'], $u['siti']]);

        $general = $this->channel($org, 'general', 'public', 'Everything Kopi Kita', $u['farah'], [$u['farah'], $u['zul'], $u['siti'], $u['daniel']]);
        $this->channel($org, 'outlet-managers', 'private', 'Outlet managers only', $u['farah'], [$u['farah'], $u['zul']]);
        $this->messages($org, $general, [
            [$u['farah'], 'New seasonal menu launches next Monday! ☕'],
            [$u['siti'], 'Training session for the new drinks is on Saturday morning.'],
            [$u['zul'], 'Stock for Gula Melaka Latte arrives Thursday.'],
        ]);

        $launch = $this->project($org, 'Seasonal Menu Launch', 'Launch the year-end seasonal drinks menu across all outlets.',
            'active', Project::VISIBILITY_ORGANIZATION, $u['zul'], [$u['siti'], $u['daniel']], -7, 14);
        $this->tasks($org, $launch, $u['zul'], [
            ['Train baristas on new recipes', 'in_progress', 'high', $u['siti'], 4, ['Recipe cards', 'Tasting session']],
            ['Print menu boards', 'todo', 'medium', $u['zul'], 6, []],
            ['Update POS items', 'todo', 'medium', $u['daniel'], 5, []],
        ]);

        $this->event($org, 'Barista training', null, 'Outlet SS2', null, 3, 9, 120, 'participants', $u['siti'], [$u['zul']]);
        $org->announcements()->create([
            'author_id' => $u['farah']->id, 'title' => 'Seasonal menu goes live Monday',
            'body' => 'Please make sure every outlet has the new menu boards up by Sunday night.',
            'audience' => 'organization', 'requires_acknowledgement' => true, 'pinned_at' => now(),
        ]);

        $this->reportsTo($org, ['zul' => 'farah', 'siti' => 'zul', 'daniel' => 'zul']);
        $this->launcher($org, $u['farah'], ['siti' => ['timesheet', 'lms'], 'zul' => ['project', 'approval']]);
        (new FormApprovalDemoSeeder)->kopiKita($org, $u);
    }

    // ----------------------------------------------------------------- helpers

    /** @param array<string, string> $lines person key => manager key */
    private function reportsTo(Organization $org, array $lines): void
    {
        foreach ($lines as $person => $manager) {
            OrganizationMembership::where('organization_id', $org->id)->where('user_id', $this->users[$person]->id)
                ->update(['manager_id' => $this->users[$manager]->id]);
        }
    }

    /**
     * Default apps, one banner and some pins.
     *
     * @param  array<string, list<string>>  $pins  person key => app keys
     */
    private function launcher(Organization $org, User $owner, array $pins): void
    {
        AppCatalog::installDefaults($org, $owner);

        $org->banners()->create([
            'title' => 'Center of Excellence',
            'description' => 'Aims to develop and train talents to continue the legacy and sustain the ecosystem of mainframe technology',
            'cta_label' => 'Learn more',
            'cta_url' => '/apps/lms',
            'illustration' => 'excellence',
            'is_active' => true,
            'sort_order' => 0,
            'created_by' => $owner->id,
        ]);

        $apps = LauncherApp::pluck('id', 'key');
        foreach ($pins as $person => $keys) {
            foreach ($keys as $key) {
                UserAppPin::create(['organization_id' => $org->id, 'user_id' => $this->users[$person]->id, 'app_id' => $apps[$key]]);
            }
        }
    }

    private function organization(string $name, string $slug, User $owner, array $attrs): Organization
    {
        Organization::where('slug', $slug)->delete();

        $org = Organization::create([...$attrs, 'name' => $name, 'slug' => $slug, 'timezone' => 'Asia/Kuala_Lumpur', 'created_by' => $owner->id]);
        $org->forceFill(['onboarding_completed_at' => now()])->save();
        ActivityLog::audit($org->id, $owner, 'organization.created', $org);

        return $org;
    }

    private function members(Organization $org, array $members): void
    {
        foreach ($members as [$user, $role]) {
            OrganizationMembership::create([
                'organization_id' => $org->id, 'user_id' => $user->id, 'role' => $role,
                'status' => OrganizationMembership::STATUS_ACTIVE, 'joined_at' => now()->subDays(30),
            ]);
        }
    }

    private function department(Organization $org, $department, array $users): void
    {
        $department->users()->sync(collect($users)->mapWithKeys(fn ($u) => [$u->id => ['organization_id' => $org->id]])->all());
    }

    private function channel(Organization $org, string $name, string $visibility, string $topic, User $creator, array $members): Conversation
    {
        $channel = $org->conversations()->create([
            'type' => 'channel', 'name' => $name, 'topic' => $topic, 'visibility' => $visibility, 'created_by' => $creator->id,
        ]);
        foreach (collect($members)->unique('id') as $m) {
            $channel->memberships()->create(['user_id' => $m->id, 'role' => $m->id === $creator->id ? 'admin' : 'member', 'joined_at' => now()->subDays(20)]);
        }

        return $channel;
    }

    private function direct(Organization $org, User $a, User $b): Conversation
    {
        $dm = $org->conversations()->create([
            'type' => 'direct', 'visibility' => 'private', 'direct_key' => Conversation::directKey($a->id, $b->id), 'created_by' => $a->id,
        ]);
        $dm->memberships()->createMany([['user_id' => $a->id, 'joined_at' => now()], ['user_id' => $b->id, 'joined_at' => now()]]);

        return $dm;
    }

    private function messages(Organization $org, Conversation $conversation, array $messages): void
    {
        $time = CarbonImmutable::now()->subHours(count($messages) * 2);
        $last = null;
        foreach ($messages as $i => $m) {
            $created = $time->addMinutes($i * 37);
            $last = $conversation->messages()->create([
                'organization_id' => $org->id, 'user_id' => $m[0]->id, 'client_id' => (string) Str::uuid(),
                'body' => $m[1], 'mentions' => $m[2] ?? null, 'created_at' => $created, 'updated_at' => $created,
            ]);
        }
        $conversation->forceFill(['last_message_at' => $last->created_at])->save();
        // Senders and early readers have read up to the last message.
        $conversation->memberships()->whereIn('user_id', collect($messages)->pluck(0)->pluck('id')->take(1))->update(['last_read_message_id' => $last->id]);
    }

    private function project(Organization $org, string $name, string $description, string $status, string $visibility, User $manager, array $members, int $startOffset, int $targetOffset): Project
    {
        $project = $org->projects()->create([
            'name' => $name, 'description' => $description, 'status' => $status, 'visibility' => $visibility,
            'manager_id' => $manager->id, 'created_by' => $manager->id,
            'start_date' => now()->addDays($startOffset)->toDateString(), 'target_date' => now()->addDays($targetOffset)->toDateString(),
        ]);
        $project->memberships()->create(['organization_id' => $org->id, 'user_id' => $manager->id, 'role' => 'manager']);
        foreach ($members as $m) {
            $project->memberships()->create(['organization_id' => $org->id, 'user_id' => $m->id, 'role' => 'member']);
        }
        ActivityLog::record($org->id, $manager, 'project.created', $project, ['name' => $name], $project->id);

        return $project;
    }

    private function tasks(Organization $org, Project $project, User $creator, array $tasks): void
    {
        foreach ($tasks as $i => [$title, $status, $priority, $assignee, $dueOffset, $checklist]) {
            $task = $project->tasks()->create([
                'organization_id' => $org->id, 'title' => $title, 'status' => $status, 'priority' => $priority,
                'assignee_id' => $assignee?->id, 'created_by' => $creator->id, 'position' => $i,
                'due_date' => now('Asia/Kuala_Lumpur')->addDays($dueOffset)->toDateString(),
                'completed_at' => $status === 'done' ? now()->subDays(abs($dueOffset) + 1) : null,
                'description' => 'Fictional demo task for '.$project->name.'.',
            ]);
            foreach ($checklist as $j => $item) {
                $task->checklistItems()->create(['body' => $item, 'is_done' => $status === 'done' || $j === 0, 'position' => $j]);
            }
            ActivityLog::record($org->id, $creator, 'task.created', $task, ['title' => $title], $project->id);
            if ($status !== 'todo') {
                ActivityLog::record($org->id, $assignee ?? $creator, 'task.status_changed', $task,
                    ['field' => 'status', 'title' => $title, 'from' => 'todo', 'to' => $status], $project->id);
            }
        }
        $first = $project->tasks()->orderBy('id')->first();
        $first?->comments()->create(['user_id' => $creator->id, 'body' => 'Looks great — let us review this at the next stand-up.']);
    }

    private function event(Organization $org, string $title, ?string $desc, ?string $location, ?string $url, int $dayOffset, int $hour, int $minutes, string $audience, User $creator, array $participants): void
    {
        $start = CarbonImmutable::now($org->timezone)->addDays($dayOffset)->setTime($hour, 0)->utc();
        $event = $org->events()->create([
            'title' => $title, 'description' => $desc, 'location' => $location, 'meeting_url' => $url,
            'starts_at' => $start, 'ends_at' => $start->addMinutes($minutes), 'audience' => $audience,
            'reminder_minutes' => 15, 'created_by' => $creator->id,
        ]);
        $event->participants()->sync(collect($participants)->pluck('id')->push($creator->id)->unique()->all());
    }

    private function notify(Organization $org, User $user, string $type, string $title, string $link, User $actor): void
    {
        UserNotification::create([
            'user_id' => $user->id, 'organization_id' => $org->id, 'type' => $type, 'title' => $title,
            'link' => $link, 'actor_id' => $actor->id,
        ]);
    }
}
