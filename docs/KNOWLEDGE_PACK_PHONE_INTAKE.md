# Phone intake knowledge pack — Emily → US Tow Dispatch

What the inbound AI dispatcher needs to know to take a new tow from a private
customer and put it into US Tow Dispatch correctly, most of the time.

Chris, 2026-08-23: *"we will need extensive knowledge pack developed for the AI
intake dispatcher to be able to get this task 90 percent right most of the
time."*

Distinct from the two packs that already exist:

| Pack | Answers |
|---|---|
| `KNOWLEDGE_PACK_V2.md` | questions *about the business* |
| `KNOWLEDGE_PACK_DISPATCH.md` | what a driver needs to know on arrival |
| **this one** | how a phone call becomes a correct row in USTD |

---

## What "90% right" actually means

Not "90% of calls sound good". Ninety per cent of calls should produce a job a
dispatcher can send a truck to **without ringing the customer back**. That is
the bar, and it is a high one, because a callback costs more than the call did.

Four things have to be right for that, in descending order of how expensive
they are to get wrong:

1. **Location.** Wrong location is a wasted truck and an hour of nothing.
2. **Vehicle class.** Wrong class is the wrong truck, which is a second truck.
3. **Service type.** Wrong type is the wrong equipment and the wrong price.
4. **Everything else.** Recoverable by a phone call from the office.

Ordering matters because it tells the agent what to slow down on. Emily should
spend three exchanges nailing a location and one exchange on the colour.

---

## Ground truth: what USTD actually accepts

Not invented. Read from `packages/shared/src/schemas/job.ts` and
`vehicle.ts` on 2026-08-23. If these lists drift, this pack is wrong.

**serviceType** — `tow`, `jump_start`, `lockout`, `tire_change`, `fuel`,
`winch`, `recovery`, `impound`, `repo`, `other`

**vehicleClass** — `light_duty`, `medium_duty`, `heavy_duty`, `motorcycle`,
`commercial`, `rv`, `unknown`

**drivetrain** — `2WD`, `4WD`, `RWD`, `AWD`, `EV`, `Hybrid`

**authorizedBy** — `customer`, `repair_shop`, `dealership`, `insurance`,
`motor_club`, `account_contact`, `police`, `other`

For a private cash caller, `authorizedBy` is **always `customer`**. If the
caller is arranging it for somebody else — a shop, a dealer, a fleet — that is
not a private cash call and the price is different. Ask who is paying, once.

---

## 1. Location — the one to get right

A customer almost never knows their address. They know what they can see.
Emily's job is to convert "I'm on 270 near the zoo" into something a driver can
navigate to, and to know when she has enough.

### Enough, by situation

| Where they are | Enough is |
|---|---|
| Street address | House number + street + city. Read back once. |
| Highway | Route number **+ direction of travel** + nearest exit number or mile marker |
| Parking garage | Address + **level** + nearest stairwell or space number |
| Large campus | The building, not the campus. "OSU" is not a location. |
| Parking lot | The business name + which side of the building |
| Rural | Nearest cross street + a landmark, and the county if they know it |

### The three questions that unstick a vague location

1. "What's the last thing you drove past?"
2. "Is there a business or a sign you can see from where you are?"
3. "If you open your maps app, it'll show a blue dot with an address — can you
   read me what it says?"

The third works more often than it sounds like it should and is worth asking
before giving up.

### Direction of travel is not optional on a highway

Northbound and southbound I-71 are different places, separated by a barrier and
sometimes several miles of driving. Emily must never accept a highway location
without a direction. If the caller does not know, ask what city they were
heading toward.

### Columbus specifics

Roadside is Columbus-based, and these come up constantly:

- **Ohio State University** — a large share of volume. "OSU" or "campus" is not
  a location. Get the building or the garage.
- **Ohio State Fairgrounds** — has its own access rules and gates. Flag it in
  the notes; the driver needs to know which gate.
- **Parking garages** — Columbus has a lot of them, and clearance is a
  truck-selection problem, not a note. See vehicle class below.
- **270 / 315 / 71 / 70** — always get the direction.

---

## 2. Vehicle class — which truck rolls

This is the field most likely to be got wrong quietly, because the caller does
not know the answer and Emily can guess from the model. She must not.

| Class | What it is | Ask |
|---|---|---|
| `light_duty` | Cars, most pickups, most SUVs, minivans | default |
| `medium_duty` | Box trucks, large duallies, sprinter vans | "Is it a dually? A box truck?" |
| `heavy_duty` | Semis, buses, large RVs | obvious from the description |
| `motorcycle` | Motorcycle | obvious |
| `rv` | Motorhome, large camper | "Is it a motorhome or a towable?" |
| `commercial` | Company vehicle over light duty | ask who owns it |
| `unknown` | She could not establish it | **use this rather than guessing** |

`unknown` exists for a reason. A wrong class sends the wrong truck; `unknown`
makes a dispatcher look. Guessing does not.

### Clearance — a gate, not a note

If the vehicle is in a parking garage, an underground car park, or anywhere with
a ceiling, Emily must ask and record it. A flatbed will not fit in most Columbus
garages. This decides the truck, so it belongs in the intake and not in a
comment somebody reads later.

### Drivetrain — always ask, never infer

Motor-club tickets are right about drivetrain roughly half the time, which is
why the existing dispatch pack says ask open rather than confirm. A coin-flip
field confirmed by a stressed person on a highway is worth nothing.

Ask plainly: **"Is it all-wheel or four-wheel drive?"** If they do not know,
record that they did not know. Do not answer it for them from the model — trim
levels differ, and an AWD car towed on two wheels is a destroyed transmission
and a claim.

**EV** is its own answer and matters more than the others: high-voltage
handling, no neutral on many models, and a flatbed is usually mandatory.

---

## 3. Service type — from what they say to what USTD stores

| They say | serviceType | Notes |
|---|---|---|
| "It won't start" | `jump_start` **or** `tow` | Ask if it turns over. Clicking = battery, jump first. Nothing at all = tow. |
| "I have a flat" | `tire_change` | Ask if they have a spare. No spare = `tow`. |
| "I locked my keys in" | `lockout` | |
| "I ran out of gas" | `fuel` | |
| "I'm in a ditch / stuck / off the road" | `winch` | Ask how far off the road and whether it is upright |
| "I was in an accident" | `tow` | Also flag it — accident tows price differently |
| "It's overheating / making a noise / won't shift" | `tow` | |
| "I need it moved" | `tow` | |
| Rollover, vehicle on its side or roof | `recovery` | Not a winch. Different equipment, different price. |

### The distinction that costs money

**Winch vs recovery.** A car with two wheels in a soft shoulder is a winch. A
vehicle on its roof, down an embankment, or needing more than one truck is a
recovery. Emily should ask *"is it upright, and is it still on the pavement?"*
rather than trying to price it.

### Roadside service that turns into a tow

Perfectly normal and must be handled without a second call: the jump fails, or
there is no spare. Emily books the service she was told about and notes that a
tow may be needed. The driver upgrades it on scene.

---

## 4. What she must capture, in order

The order is deliberate. Safety first, then the things that decide the truck,
then everything else. If the call drops after question 4 there is still a
dispatchable job.

1. **Safety.** "Are you somewhere safe, out of traffic?"
2. **Callback number.** The single most important field. If the call drops,
   everything else can be recovered by ringing back — this cannot.
3. **Location** (see §1).
4. **What happened** → serviceType.
5. **Where it's going.** "I don't know yet" is an acceptable answer; do not
   stall the job on it.
6. **Vehicle** — year, make, model, colour.
7. **Class and clearance** (see §2).
8. **Drivetrain**, keys, and whether it rolls / steers / brakes.
9. **Name.**

Name is ninth on purpose. It is the field every script asks first and the field
that matters least — a job with a location, a phone number and a vehicle is
dispatchable with no name at all.

---

## 5. Gates — stop the intake and get a human

Any one of these ends the questions immediately:

- Anyone injured, or an ambulance has been called
- The vehicle is in a live lane of traffic
- The caller is on a highway shoulder and outside the vehicle
- A crash involving another vehicle, or police on scene
- The caller sounds frightened, or a child or animal is in the vehicle
- Fire, smoke, or fuel leaking
- The caller is a minor

**"Stay where you are — I'm putting you straight through to dispatch right
now."** Then transfer. Do not finish the form first.

---

## 6. Price

USTD holds the rate table and the rate engine. Emily does not carry a copy and
must never quote from memory — a stale price is a dispute.

The intake response comes back with a `rateQuote` computed off the live sheet.
Until there is a quote-before-commit route, the sequence is: create the job,
read the quote back, and dispatch. Chris, 2026-08-23: **the truck goes, and
payment is resolved after.**

Card details are never spoken. Payment is a link the customer opens on their own
phone.

### What she may say about money

Nothing beyond what the API returns her. If the caller pushes before there is a
number: *"Dispatch will confirm the price with you before a truck rolls."*

---

## 7. The VIN and email rules

Neither is required by the phone-intake endpoint. Both leave a trace.

**No VIN** → every such job carries, prepended to the notes:

> NO VIN ON INTAKE — taken by phone. Driver must document the VIN and plate
> number with admin/dispatch, or enter them into US Tow Dispatch, at the pickup
> location BEFORE performing the requested service.

**No email** → a note saying to collect it at pickup or in follow-up.

Emily should still *ask* for a plate. It is easy to read off a car, it dedupes
the vehicle in USTD, and it makes the driver's job at pickup smaller.

---

## 8. Where this pack is silent

The standing rule, unchanged: **do not invent policy to fill a gap.** Where this
document does not answer it, the office calls the customer back.

Open items needing Chris:

- [ ] **TBD** — After-hours or holiday handling: does the intake change at 2am?
- [ ] **TBD** — Service area. How far out do we go before it is a decline, and
      is there a mileage beyond which dispatch must approve?
- [ ] **TBD** — Do we tow to a residence, or only to a shop?
- [ ] **TBD** — Motorcycle and EV: any truck or equipment restriction Emily
      should know about at intake?
- [ ] **TBD** — Storage: what does she say if the destination is our yard?
- [ ] **TBD** — What she says when the caller asks how long it will be. The
      existing inbound rule is the "around thirty minutes" line; is that right
      for a brand-new job with no truck assigned?

That last one matters most. A new job has no driver and no ETA, and the
thirty-minute line was written for a job already on the board.
