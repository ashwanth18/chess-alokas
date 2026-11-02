/**
 * Invented people for the demo tenant. Schools and clubs use "Contoh" (Malay for "example"), and
 * nobody has a FIDE id, since an invented number could belong to someone.
 */
export interface DemoPerson {
  key: string;
  name: string;
  gender: 'M' | 'F';
  yearOfBirth: number;
  rating: number | null;
  school: string;
  city: string;
  state: string;
}

const KL = ['Kuala Lumpur', 'Wilayah Persekutuan'] as const;
const PJ = ['Petaling Jaya', 'Selangor'] as const;
const SA = ['Shah Alam', 'Selangor'] as const;
const PG = ['George Town', 'Pulau Pinang'] as const;
const JB = ['Johor Bahru', 'Johor'] as const;
const IP = ['Ipoh', 'Perak'] as const;

function person(
  key: string,
  name: string,
  gender: 'M' | 'F',
  yearOfBirth: number,
  rating: number | null,
  school: string,
  place: readonly [string, string],
): DemoPerson {
  return { key, name, gender, yearOfBirth, rating, school, city: place[0], state: place[1] };
}

/** The people behind the demo accounts. */
export const AINA = person('aina', 'Aina Sofea binti Rashid', 'F', 2015, 1284, 'SK Taman Contoh', PJ);
export const HAZIQ = person('haziq', 'Haziq Danial bin Rashid', 'M', 2017, 1106, 'SK Taman Contoh', PJ);
export const PRIYA = person('priya', 'Priya a/p Selvam', 'F', 2010, 1642, 'SMK Bandar Contoh', PJ);

export const OPEN_PLAYERS: DemoPerson[] = [
  person('o01', 'Muhammad Irfan bin Zulkifli', 'M', 2004, 2086, 'Kelab Catur Contoh', KL),
  person('o02', 'Tan Wei Jie', 'M', 2006, 2011, 'SMJK Contoh', PG),
  person('o03', 'Arjun a/l Suresh', 'M', 2007, 1963, 'SMK Bandar Contoh', PJ),
  person('o04', 'Nurul Izzah binti Hamzah', 'F', 2005, 1902, 'Kelab Catur Contoh', SA),
  person('o05', 'Lee Jun Hao', 'M', 2008, 1874, 'SMJK Contoh', KL),
  person('o06', 'Kavitha a/p Ramasamy', 'F', 2007, 1838, 'SMK Seri Contoh', IP),
  person('o07', 'Ahmad Syafiq bin Roslan', 'M', 2003, 1811, 'Kelab Catur Contoh', JB),
  person('o08', 'Ong Mei Ling', 'F', 2009, 1786, 'SMJK Contoh', PG),
  person('o09', 'Daniel Raj a/l Gopal', 'M', 2008, 1752, 'SMK Seri Contoh', KL),
  person('o10', 'Siti Khadijah binti Azman', 'F', 2006, 1731, 'SMK Bandar Contoh', SA),
  person('o11', 'Chong Kah Wai', 'M', 2007, 1705, 'Kelab Catur Contoh', PJ),
  person('o12', 'Amirul Hakim bin Fauzi', 'M', 2009, 1688, 'SMK Seri Contoh', JB),
  person('o13', 'Lim Xin Yi', 'F', 2010, 1621, 'SMJK Contoh', KL),
  person('o14', 'Vikram a/l Muthu', 'M', 2009, 1598, 'SMK Bandar Contoh', IP),
  person('o15', 'Farah Nabila binti Ismail', 'F', 2008, 1574, 'SMK Seri Contoh', SA),
  person('o16', 'Goh Zhi Hao', 'M', 2010, 1550, 'SMJK Contoh', PJ),
  person('o17', 'Hafiz Aiman bin Yusof', 'M', 2007, 1533, 'Kelab Catur Contoh', KL),
  person('o18', 'Deepa a/p Krishnan', 'F', 2010, 1507, 'SMK Bandar Contoh', PG),
  person('o19', 'Yap Jia Xuan', 'F', 2009, 1486, 'SMJK Contoh', JB),
  person('o20', 'Zul Hilmi bin Kassim', 'M', 2006, 1462, 'Kelab Catur Contoh', IP),
  person('o21', 'Ng Kok Leong', 'M', 2005, 1431, 'Kelab Catur Contoh', PJ),
  person('o22', 'Thanush a/l Ravi', 'M', 2011, 1402, 'SMK Seri Contoh', KL),
  person('o23', 'Balqis Maisarah binti Nordin', 'F', 2011, null, 'SMK Bandar Contoh', SA),
];

export const JUNIOR_PLAYERS: DemoPerson[] = [
  person('j01', 'Adam Harris bin Khairul', 'M', 2015, 1412, 'SK Seri Contoh', KL),
  person('j02', 'Wong Yi Xuan', 'F', 2015, 1377, 'SJK(C) Contoh', PG),
  person('j03', 'Rohan a/l Prakash', 'M', 2016, 1345, 'SK Taman Contoh', PJ),
  person('j04', 'Sofia Aleesya binti Hanif', 'F', 2015, 1318, 'SK Seri Contoh', SA),
  person('j05', 'Chan Jun Kit', 'M', 2016, 1251, 'SJK(C) Contoh', KL),
  person('j06', 'Nisha a/p Balan', 'F', 2016, 1223, 'SJK(T) Contoh', IP),
  person('j07', 'Luqman Hakeem bin Saiful', 'M', 2017, 1198, 'SK Taman Contoh', JB),
  person('j08', 'Tee Xin Rou', 'F', 2016, 1174, 'SJK(C) Contoh', PJ),
  person('j09', 'Iman Naufal bin Azhar', 'M', 2017, 1149, 'SK Seri Contoh', SA),
  person('j10', 'Kiran a/l Devan', 'M', 2017, 1087, 'SJK(T) Contoh', KL),
  person('j11', 'Hana Humaira binti Faizal', 'F', 2018, 1052, 'SK Taman Contoh', PJ),
  person('j12', 'Foo Zi Yang', 'M', 2017, 1024, 'SJK(C) Contoh', JB),
  person('j13', 'Puteri Alya binti Zainal', 'F', 2018, 981, 'SK Seri Contoh', IP),
  person('j14', 'Seah Wen Qi', 'F', 2018, 946, 'SJK(C) Contoh', PG),
  person('j15', 'Akif Rayyan bin Hisham', 'M', 2018, null, 'SK Taman Contoh', SA),
];

export const SAMPLE_NRIC = '000000-00-0000';

export function demoEmailFor(person: DemoPerson, domain: string): string {
  return `${person.key}@${domain}`;
}
