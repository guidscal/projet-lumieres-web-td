// =====================================================================================
//  EDIT THIS FILE to change what the page shows. After any change, save it and run
//      npx wrangler deploy
//  then reload the page on your phone (pull to refresh).
//
//  Every control becomes one or more values in TouchDesigner (see the list at the bottom).
//  `id` must be unique, lowercase letters / digits / underscore only (it becomes a channel name).
// =====================================================================================

const CONFIG = {

  lightCount: 3,                       // how many lights get their own card
  lightNames: ['Rez-de-Chaussee','Sous-Sol', 'Cinema-Maison'],                      // optional, e.g. ['Porch', 'Stairs', 'Window']; empty = Light 1, 2, 3
  defaultColors: ['#f75e1c', '#ff9900', '#881ee4', '#85e21f'],   // starting colors (rotated from light to light)
  sendInterval: 40,                    // ms; limits how often values are sent while you drag a slider

  // ---- big buttons at the top of the page. They fire for ALL lights at once ------------
  topButtons: [
    { id: 'pulserandom', label: 'PULSE RANDOM' },
    { id: 'pulse', label: 'PULSE ALL' },
    { id: 'vibechangenow', label: 'CHANGE COLORS NOW' },
    //{ id: 'blackout', label: 'BLACKOUT' },          // <- remove the // to add another button
  ],

  // ---- settings that apply to the whole project (shown in the top box) -----------------
  globalControls: [
    //{ type: 'slider', id: 'master', label: 'Master brightness', min: 0, max: 1, step: 0.01, default: 1 },
    { type: 'toggle', id: 'storm',  label: 'Storm automatic', default: true },
    { type: 'toggle', id: 'blackout',  label: 'Blackout', default: false },
    { type: 'range', id: 'wait', label: 'Time between strikes', min: 1, max: 120, default: [5, 20] },
    { type: 'slider', id: 'vibechange', label: 'Time between color change', min: 5, max: 240, step: 1, default: 30 },
    //{ type: 'choice', id: 'style',  label: 'Style', options: ['Soft', 'Hard', 'Strobe'], default: 0 },
  ],

  // ---- controls repeated on EVERY light's card -----------------------------------------
  lightControls: [

    // 4 colors per light. modeSwitch adds a switch at the top: all 4 colors, or 1 constant color.
    { type: 'colors', id: 'c', label: 'Colors', count: 4,
      modeSwitch: { id: 'colormode', labels: ['4 colors per light', '1 color per light'] } },

    // A button on each light's card.
    { type: 'button', id: 'pulsesingle', label: 'PULSE' },

    // More examples (remove the // to try them):
    { type: 'slider', id: 'bright', label: 'Brightness', min: 0, max: 1, step: 0.01, default: 1, shared: {} },
    { type: 'toggle', id: 'on', label: 'Light on', default: true },
    //{ type: 'button', id: 'strobe', label: 'STROBE' },
  ],
};

/* ---------------------------------------------------------------------------------------
   CONTROL TYPES (what you can put in globalControls / lightControls)

   slider   { type:'slider', id, label, min, max, step, default, unit, log }   -> id
   toggle   { type:'toggle', id, label, default }                              -> id (0 or 1)
   choice   { type:'choice', id, label, options:['A','B','C'], default }       -> id (0, 1, 2...)
   color    { type:'color',  id, label, default:'#ff0000' }                    -> id_r id_g id_b (0 to 1)
   colors   { type:'colors', id, label, count, modeSwitch }                    -> id1_r id1_g id1_b, id2_r ...
   range    { type:'range',  id, label, min, max, default:[lo, hi], unit }     -> id_min id_max
   button   { type:'button', id, label }                                       -> id (1 for ~100 ms)

   Optional on slider / toggle / choice / color / range inside lightControls:
     shared: { labels: ['Same for all', 'One per light'] }
       adds a switch: one value for every light, or a separate value on each light's card.

   VALUES IN TOUCHDESIGNER (rows of the `state` table, then channels of `inputs`)
     global controls ........ g_<id>            e.g.  g_master, g_storm
     light controls ......... l1_<id>, l2_<id>  e.g.  l1_c1_r, l2_wait_min, l3_bright
     shared controls ........ also g_<id>_shared (1 = same value for all lights)
     buttons ................ g_<id> and l1_<id>, l2_<id>... (a top button fires them all)
     number of lights ....... lights
   --------------------------------------------------------------------------------------- */
