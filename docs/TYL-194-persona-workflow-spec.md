# TYL-194: AI Influencer Studio — "New Persona" Fix + Full Workflow Design

**Branch:** `feat/influencer-studio-persona-workflow` (off `86f29b09`)  
**Status:** NEEDS-APPROVAL

---

## 1. Current State Analysis

The "New Persona" button exists in two places:
- **Personas page** (`/personas`): Working correctly — opens `NewPersonaWizard` dialog
- **Image Studio page** (`/image-studio`): ✅ **ALREADY FIXED** — `onClick={() => setWizardOpen(true)}` wired at line 1373

The wizard itself (`NewPersonaWizard.tsx`) is fully functional with a 3-step flow:
1. **Identity** — name, bio, structured attributes (creates persona with `status='untrained'`)
2. **Training photos** — batch upload (skippable)
3. **Generate & train** — picks trainer, fires LoRA training job

**Verification:** The button fix was already implemented in commit `86f29b09`:
- State hook: `const [wizardOpen, setWizardOpen] = useState(false);` (line 1284)
- Handler: `onClick={() => setWizardOpen(true)}` (line 1373)
- Wizard mounted: `<NewPersonaWizard open={wizardOpen} onOpenChange={setWizardOpen} />` (line 1413)

---

## 2. The "New Persona" Button Status

**File:** `ui/src/pages/ImageStudio.tsx`

**Status:** ✅ **FIXED** — No code changes required. The button is fully functional at `86f29b09`.

---

## 3. Full "Create an Influencer" Workflow Design

Building on the existing 3-step wizard, here's the complete persona-to-influencer pipeline:

### Phase A: Persona Creation (Existing — Working)
- **Step 1:** Identity form → `POST /companies/{id}/image-studio/personas` → creates `untrained` persona
- **Step 2:** Training photos → `POST /api/assets` upload → `PATCH /image-studio/personas/{id}` (avatar_path)
- **Step 3:** Trainer selection → `POST /companies/{id}/image-studio/personas/{id}/train` → fires LoRA job

**Endpoint shapes verified at `86f29b09`:**
- `imageStudioApi.createPersona()` → returns `{ provider: ImageProvider }`
- `imageStudioApi.trainPersona()` → returns `{ job, photos, provider, trainer, estimatedCostUsd, estimatedMinutes, note }`
- `imageStudioApi.listTrainers()` → returns `{ providers: TrainerProviderGroup[] }`

### Phase B: Influencer Activation (New — Design)

After persona training completes (`status='ready'`), convert to a full **Influencer**:

| Field | Source |
|-------|--------|
| `persona_id` | The trained ImageProvider ID |
| `name` | Persona name |
| `bio` | Persona bio |
| `avatar_url` | Persona avatarPath |
| `trigger_word` | `personaTriggerWord(persona)` |
| `platforms` | User selects (Instagram, TikTok, X, etc.) |
| `content_style` | Pick from templates or custom |
| `posting_schedule` | Frequency + timezone |

**New API endpoints needed:**
```
POST   /influencers                    # Create from persona
GET    /influencers                    # List with platform stats
GET    /influencers/:id                # Detail with recent posts
PATCH  /influencers/:id                # Update config
POST   /influencers/:id/generate-post  # Fire content-gen pipeline
POST   /influencers/:id/schedule       # Queue to posting pipeline
```

### Phase C: Content Generation Integration

The `86f29b09` endpoints already support persona-driven generation:
- `POST /image-studio/personas/{id}/generate` — single/batch generation
- `POST /image-studio/personas/{id}/batch-generate` — PhotoShoot categories
- Template system with `persona_id` filtering

**Influencer content loop:**
1. User picks influencer → persona pre-selected
2. Pick template or free-form prompt
3. Generate batch (uses persona's trigger word + LoRA)
4. Review → approve → schedule to platform

---

## 4. UI/UX Additions Needed

### Image Studio Page
- ✅ "New Persona" button already wired — no changes needed

### New "Influencers" Tab/Page
- List view: avatar, name, platforms, last post, status
- "Create from Persona" button (pick from ready personas)
- Per-influencer: content feed, schedule, analytics stub

### Persona Detail Page Enhancement
- "Make Influencer" CTA (only when `status='ready'`)
- Quick actions: Generate, PhotoShoot, Undresser (already exist)

---

## 5. Files to Modify (for Phase B)

| File | Change |
|------|--------|
| `ui/src/pages/Personas.tsx` | Add "Create Influencer" action to ready personas |
| `ui/src/components/personas/NewPersonaWizard.tsx` | Add optional `onCreated` callback for influencer flow |
| *(new)* `ui/src/pages/Influencers.tsx` | Full influencer management surface |
| *(new)* `ui/src/api/influencers.ts` | API client for influencer endpoints |

---

## 6. Testing Checklist

- [x] Image Studio "New Persona" button opens wizard (verified at `86f29b09`)
- [ ] Wizard Step 1 creates persona (verify `status='untrained'`)
- [ ] Wizard Step 2 uploads photos (verify asset paths)
- [ ] Wizard Step 3 fires training job (verify job queued)
- [ ] Training completion flips `status='ready'`
- [ ] Ready persona shows "Create Influencer" CTA
- [ ] Influencer creation links to persona
- [ ] Content generation uses correct trigger word

---

## 7. Implementation Notes

- The wizard is already test-covered (`data-testid` attributes present)
- The `86f29b09` commit fixed serviceUnavailable errors and added GEMINI_MODEL env override
- Rate limiting is handled at the API layer
- All persona operations are scoped to `selectedCompanyId`
- **Phase A is complete** — button fix already shipped
- **Phase B requires backend endpoints** — recommend Tyler review before building

---

**SHA:** `86f29b09` (base) — button fix already present  
**Branch:** `feat/influencer-studio-persona-workflow`  
**Deliverable:** Workflow design spec + verification that button fix is complete

---

STATUS: NEEDS-APPROVAL
