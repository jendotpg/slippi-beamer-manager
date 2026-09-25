import {
  characterColorIndexLength,
  unknownCharacterId,
} from '../common/constants';

const characterIcons = import.meta.glob<string>('./characters/*/*/stock.png', {
  eager: true,
  import: 'default',
});

const iconFor = (externalCharacterId: number, costumeIndex: number) =>
  characterIcons[
    `./characters/${externalCharacterId}/${costumeIndex}/stock.png`
  ];

export default function getCharacterIcon(
  externalCharacterId: number,
  costumeIndex: number,
) {
  const costumes = characterColorIndexLength.get(externalCharacterId);
  if (costumes === undefined) {
    return iconFor(unknownCharacterId, 0);
  }
  if (costumeIndex >= costumes) {
    return iconFor(externalCharacterId, 0);
  }
  return iconFor(externalCharacterId, costumeIndex);
}
