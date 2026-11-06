<?php

namespace App\Models\Crm;

use Illuminate\Database\Eloquent\Model;

class Stage extends Model
{
    protected $table = 'crm_stages';

    public const KIND_OPEN = 'open';

    public const KIND_WON = 'won';

    public const KIND_LOST = 'lost';

    protected $fillable = ['organization_id', 'name', 'position', 'probability', 'kind'];

    protected function casts(): array
    {
        return ['position' => 'integer', 'probability' => 'integer'];
    }

    /** Default pipeline for a new organisation. */
    public const DEFAULTS = [
        ['name' => 'Lead', 'probability' => 10, 'kind' => 'open'],
        ['name' => 'Qualified', 'probability' => 25, 'kind' => 'open'],
        ['name' => 'Proposal', 'probability' => 50, 'kind' => 'open'],
        ['name' => 'Negotiation', 'probability' => 75, 'kind' => 'open'],
        ['name' => 'Won', 'probability' => 100, 'kind' => 'won'],
        ['name' => 'Lost', 'probability' => 0, 'kind' => 'lost'],
    ];
}
