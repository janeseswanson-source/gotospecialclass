export const TEACHER_TYPES = {
  cart: {
    label: 'Cart Cruiser',
    synonyms: ['Floating Teacher', 'Teacher on a Cart'],
    description: 'Moves between classrooms within one school with a cart of supplies.',
  },
  roomBased: {
    label: 'Room-Based',
    synonyms: ['Stationary Teacher'],
    description: 'Teaches from a dedicated room; students rotate in.',
  },
  itinerant: {
    label: 'Teacher Traveller',
    synonyms: ['Itinerant Teacher'],
    description: 'Travels between different schools or campuses.',
  },
} as const;

export type TeacherTypeKey = keyof typeof TEACHER_TYPES;
