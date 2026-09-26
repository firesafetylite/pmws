import { spokenText, speakLocation, speakTime, speakMessage } from '../js/speech.js';

let fails = 0;
const eq = (got, want) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`);
};
const at = (h, m) => new Date(2030, 4, 6, h, m);

eq(speakLocation('state of kansas'), 'the State of Kansas');
eq(speakLocation('STATE OF KANSAS'), 'the State of Kansas');
eq(speakLocation('The City of Dallas.'), 'the City of Dallas');
eq(speakLocation('Kansas'), 'Kansas');
eq(speakLocation('springfield county, ks'), 'Springfield County, KS');
eq(speakLocation('SPRINGFIELD COUNTY, KS'), 'Springfield County, KS');
eq(speakLocation('northern part of Sedgwick County'), 'the northern part of Sedgwick County');
eq(speakLocation('North Ridge District'), 'North Ridge District');
eq(speakLocation('entire metro area'), 'the Entire Metro Area');
eq(speakLocation('McAllen'), 'McAllen');
eq(speakLocation(''), 'the area');

eq(speakTime(at(21, 30)), '9:30 PM');
eq(speakTime(at(9, 5)), '9:05 AM');
eq(speakTime(at(18, 0)), '6 PM');
eq(speakTime(at(12, 0)), 'noon');
eq(speakTime(at(0, 0)), 'midnight');
eq(speakTime(at(0, 15)), '12:15 AM');

eq(speakMessage('take shelter now'), 'Take shelter now.');
eq(speakMessage('Leave now!'), 'Leave now!');

eq(
  spokenText({ type: 'TORW', location: 'state of kansas', expires: at(21, 30), message: 'take shelter now' }),
  'Attention. Tornado Warning for the State of Kansas, effective until 9:30 PM. Take shelter now.',
);
eq(
  spokenText({ type: 'EVAC', location: 'Test Town', expires: null, message: '' }),
  'Attention. Evacuation Order for Test Town.',
);
process.exit(fails ? 1 : 0);
