<?php

namespace Tests\Feature;

use App\Models\Attachment;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class AttachmentTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    public function test_upload_attach_and_download_follow_parent_permissions(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $member = $this->addMember($org);
        $outsider = $this->addMember($org);
        $channel = $this->createChannel($org, $owner, [$member]);

        $upload = $this->actingAs($owner)->postJson($this->api($org, '/attachments'), [
            'file' => UploadedFile::fake()->createWithContent('minutes.txt', 'Meeting minutes'),
        ])->assertCreated();
        $id = $upload->json('data.id');
        $this->assertStringNotContainsString('minutes.txt', Attachment::find($id)->path, 'Storage paths are generated');

        // Pending upload is private to the uploader.
        $this->actingAs($member)->getJson($this->api($org, "/attachments/{$id}/download"))->assertNotFound();

        $this->actingAs($owner)->postJson($this->api($org, "/conversations/{$channel->id}/messages"), [
            'client_id' => fake()->uuid(), 'attachment_ids' => [$id],
        ])->assertCreated()->assertJsonCount(1, 'data.attachments');

        $this->actingAs($member)->get($this->api($org, "/attachments/{$id}/download"))->assertOk()
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Content-Type', 'application/octet-stream');
        $this->actingAs($outsider)->getJson($this->api($org, "/attachments/{$id}/download"))->assertNotFound();

        // Access follows the parent's *current* permissions.
        $channel->memberships()->where('user_id', $member->id)->delete();
        $this->actingAs($member)->getJson($this->api($org, "/attachments/{$id}/download"))->assertNotFound();

        // The Files page lists only accessible files.
        $this->actingAs($owner)->getJson($this->api($org, '/files'))->assertJsonPath('meta.total', 1);
        $this->actingAs($outsider)->getJson($this->api($org, '/files'))->assertJsonPath('meta.total', 0);
    }

    public function test_executables_and_disguised_files_are_rejected(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);

        $this->actingAs($owner);
        $this->postJson($this->api($org, '/attachments'), ['file' => UploadedFile::fake()->create('virus.exe', 10, 'application/x-msdownload')])
            ->assertStatus(422);
        $this->postJson($this->api($org, '/attachments'), ['file' => UploadedFile::fake()->createWithContent('shell.php', '<?php echo 1;')])
            ->assertStatus(422);
        $this->postJson($this->api($org, '/attachments'), ['file' => UploadedFile::fake()->createWithContent('page.html', '<html><script>alert(1)</script></html>')])
            ->assertStatus(422);
        $this->postJson($this->api($org, '/attachments'), ['file' => UploadedFile::fake()->create('huge.pdf', 30000, 'application/pdf')])
            ->assertStatus(422);
    }

    public function test_inline_preview_is_limited_to_safe_types_and_sandboxed(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $project = $this->createProject($org, $owner);

        $id = $this->actingAs($owner)->postJson($this->api($org, '/attachments'), [
            // 1x1 PNG (avoids depending on the GD extension).
            'file' => UploadedFile::fake()->createWithContent('photo.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')),
        ])->assertCreated()->assertJsonPath('data.previewable', true)->json('data.id');
        $this->postJson($this->api($org, "/projects/{$project->id}/files"), ['attachment_ids' => [$id]])->assertOk();

        $this->get($this->api($org, "/attachments/{$id}/download?inline=1"))->assertOk()
            ->assertHeader('Content-Type', 'image/png')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertStringContainsString('sandbox', $this->get($this->api($org, "/attachments/{$id}/download?inline=1"))->headers->get('Content-Security-Policy'));
    }
}
