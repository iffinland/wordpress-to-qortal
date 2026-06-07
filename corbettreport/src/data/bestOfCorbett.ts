import image911 from '../assets/best-of-corbett/911.jpg';
import biographiesImage from '../assets/best-of-corbett/biographies.jpg';
import bookReviewsImage from '../assets/best-of-corbett/book-reviews.jpg';
import covidBiosecurityImage from '../assets/best-of-corbett/covid-biosecurity.jpg';
import crashesOfConvenienceImage from '../assets/best-of-corbett/crashes-of-convenience.jpg';
import economicsImage from '../assets/best-of-corbett/economics.jpg';
import geopoliticsImage from '../assets/best-of-corbett/geopolitics.jpg';
import healthEnvironmentImage from '../assets/best-of-corbett/health-environment.jpg';
import historyImage from '../assets/best-of-corbett/history.jpg';
import humorImage from '../assets/best-of-corbett/humor.jpg';
import literatureImage from '../assets/best-of-corbett/literature.jpg';
import mediaImage from '../assets/best-of-corbett/media.jpg';
import politicsImage from '../assets/best-of-corbett/politics.jpg';
import qaImage from '../assets/best-of-corbett/qa.jpg';
import redPillSeriesImage from '../assets/best-of-corbett/red-pill-series.jpg';
import requiemSeriesImage from '../assets/best-of-corbett/requiem-series.jpg';
import scienceImage from '../assets/best-of-corbett/science.jpg';
import solutionsImage from '../assets/best-of-corbett/solutions.jpg';

export interface BestOfLink {
  title: string;
  url: string;
}

export interface BestOfSection {
  id: string;
  title: string;
  image: string;
  links: BestOfLink[];
}

export const bestOfSections: BestOfSection[] = [
  {
    "id": "9-11",
    "title": "9/11",
    "image": image911,
    "links": [
      {
        "title": "9/11 Trillions: Follow The Money",
        "url": "https://corbettreport.com/episode-308-911-trillions-follow-the-money/"
      },
      {
        "title": "9/11 War Games",
        "url": "https://corbettreport.com/911wargames/"
      },
      {
        "title": "9/11 Whistleblowers",
        "url": "https://corbettreport.com/911whistleblowers/"
      },
      {
        "title": "9/11 Suspects",
        "url": "https://corbettreport.com/911suspects/"
      },
      {
        "title": "False Flags: The Secret History of Al Qaeda",
        "url": "https://corbettreport.com/alqaeda/"
      },
      {
        "title": "PTech and the 9/11 Software",
        "url": "https://corbettreport.com/episode-045-ptech-and-the-911-software/"
      }
    ]
  },
  {
    "id": "covid-biosecurity",
    "title": "COVID/Biosecurity",
    "image": covidBiosecurityImage,
    "links": [
      {
        "title": "COVID-911",
        "url": "https://corbettreport.com/covid911/"
      },
      {
        "title": "Corona World Order",
        "url": "https://corbettreport.com/coronaworldorder/"
      },
      {
        "title": "A Letter to the Future",
        "url": "https://corbettreport.com/letter/"
      },
      {
        "title": "Lies, Damned Lies and Coronavirus Statistics",
        "url": "https://corbettreport.com/coronastats/"
      },
      {
        "title": "The Things You Cannot Say About Coronavirus",
        "url": "https://corbettreport.com/the-things-you-cannot-say-about-coronavirus/"
      },
      {
        "title": "What NO ONE is Saying About The Corona Crisis",
        "url": "https://corbettreport.com/what-no-one-is-saying-about-the-corona-crisis/"
      },
      {
        "title": "What NO ONE is Saying About The Lockdowns",
        "url": "https://corbettreport.com/lockdowns/"
      },
      {
        "title": "Your Guide to The Great Reset",
        "url": "https://corbettreport.com/greatreset/"
      }
    ]
  },
  {
    "id": "crashes-of-convenience",
    "title": "Crashes of Convenience",
    "image": crashesOfConvenienceImage,
    "links": [
      {
        "title": "Michael Connell",
        "url": "https://corbettreport.com/episode-226-crashes-of-convenience-michael-connell/"
      },
      {
        "title": "Micheal Hastings",
        "url": "https://corbettreport.com/episode-274-crashes-of-convenience-michael-hastings/"
      },
      {
        "title": "KAL 007",
        "url": "https://corbettreport.com/episode-187-crashes-of-convenience-kal-007/"
      },
      {
        "title": "MH 17",
        "url": "https://corbettreport.com/episode-294-crashes-of-convenience-mh17/"
      },
      {
        "title": "PLF 101",
        "url": "https://corbettreport.com/episode-250-crashes-of-convenience-plf-101/"
      }
    ]
  },
  {
    "id": "economics",
    "title": "Economics",
    "image": economicsImage,
    "links": [
      {
        "title": "Century of Enslavement: The History of the Federal Reserve",
        "url": "https://corbettreport.com/federalreserve/"
      },
      {
        "title": "The Dark History of the Minimum Wage",
        "url": "https://corbettreport.com/minimumwage/"
      },
      {
        "title": "Economics in One Image",
        "url": "https://corbettreport.com/economics-in-one-image/"
      },
      {
        "title": "Meet the SDR: The Global Reserve Currency?",
        "url": "https://corbettreport.com/meet-the-sdr-the-global-reserve-currency/"
      },
      {
        "title": "The Petroyuan Was Born This Week. Here’s What It Means.",
        "url": "https://corbettreport.com/the-petroyuan-was-born-this-week-heres-what-it-means/"
      },
      {
        "title": "Think you know how to “End The Fed”? Take the #FedChallenge",
        "url": "https://corbettreport.com/think-you-know-how-to-end-the-fed-take-the-fedchallenge/"
      },
      {
        "title": "The Truth About Glass-Steagall",
        "url": "https://corbettreport.com/episode-317-the-truth-about-glass-steagall/"
      },
      {
        "title": "Why Economists Are Always Wrong",
        "url": "https://corbettreport.com/economists/"
      }
    ]
  },
  {
    "id": "geopolitics",
    "title": "Geopolitics",
    "image": geopoliticsImage,
    "links": [
      {
        "title": "The Assassination of Gaddafi",
        "url": "https://corbettreport.com/the-assassination-of-gaddafi-grtv-backgrounder/"
      },
      {
        "title": "China and the New World Order",
        "url": "https://corbettreport.com/episode-297-china-and-the-new-world-order/"
      },
      {
        "title": "Destroying the ISIL Myth (James Corbett interview)",
        "url": "https://corbettreport.com/interview-1494-destroying-the-isil-myth-on-the-last-american-vagabond/"
      },
      {
        "title": "Gladio B and the Battle for Eurasia",
        "url": "https://corbettreport.com/episode-298-gladio-b-and-the-battle-for-eurasia/"
      },
      {
        "title": "How to Play 3D Chess",
        "url": "https://corbettreport.com/how-to-play-3d-chess/"
      },
      {
        "title": "How Will WWIII Be Fought? – Questions For Corbett",
        "url": "https://corbettreport.com/how-will-wwiii-be-fought-questions-for-corbett-062/"
      },
      {
        "title": "NGOs Are The Deep State’s Trojan Horses",
        "url": "https://corbettreport.com/ngo/"
      },
      {
        "title": "The Secret Lie That Started the Afghan War",
        "url": "https://corbettreport.com/afghanwar/"
      },
      {
        "title": "The REAL Cost of the War of Terror",
        "url": "https://corbettreport.com/the-real-cost-of-the-war-of-terror/"
      },
      {
        "title": "Why is the MSM (Finally) Reporting on the Petrodollar?",
        "url": "https://corbettreport.com/why-is-the-msm-finally-reporting-on-the-petrodollar/"
      },
      {
        "title": "The White Helmets Are A Propaganda Construct",
        "url": "https://corbettreport.com/whitehelmets/"
      }
    ]
  },
  {
    "id": "health-and-environment",
    "title": "Health & Environment",
    "image": healthEnvironmentImage,
    "links": [
      {
        "title": "A Message to the Environmental Movement",
        "url": "https://corbettreport.com/a-message-to-the-environmental-movement-hd/"
      },
      {
        "title": "Are There Limits to Growth?",
        "url": "https://corbettreport.com/limitstogrowth/"
      },
      {
        "title": "5 GMO Myths Busted",
        "url": "https://corbettreport.com/5-gmo-myths-busted/"
      },
      {
        "title": "Bayer + Monsanto = A Match Made in Hell",
        "url": "https://corbettreport.com/bayer/"
      },
      {
        "title": "How Bad Global Warming Science Hurts the Environmental Movement",
        "url": "https://corbettreport.com/interview-1117-jim-steele-on-how-bad-global-warming-science-hurts-the-environmental-movement/"
      },
      {
        "title": "How Big Oil Steers the Environmental Movement",
        "url": "https://corbettreport.com/how-big-oil-steers-the-environmental-movement/"
      },
      {
        "title": "James Corbett Testifies at the National Citizens Inquiry",
        "url": "https://corbettreport.com/ncitestimony/"
      },
      {
        "title": "Rockefeller Medicine",
        "url": "https://corbettreport.com/episode-286-rockefeller-medicine/"
      },
      {
        "title": "What is the WHO?",
        "url": "https://corbettreport.com/what-is-the-who-questions-for-corbett-066/"
      },
      {
        "title": "Your Body, Their Choice",
        "url": "https://corbettreport.com/mybody/"
      }
    ]
  },
  {
    "id": "history",
    "title": "History",
    "image": historyImage,
    "links": [
      {
        "title": "Debunking A Century of War Lies",
        "url": "https://corbettreport.com/warlies/"
      },
      {
        "title": "History Is Written By The Winners",
        "url": "https://corbettreport.com/episode-350-history-is-written-by-the-winners/"
      },
      {
        "title": "How & Why Big Oil Conquered the World",
        "url": "https://corbettreport.com/bigoil/"
      },
      {
        "title": "James Corbett on The Unregistered Podcast",
        "url": "https://corbettreport.com/interview-1632-james-corbett-on-unregistered/"
      },
      {
        "title": "Truth At Last: The Assassination of MLK",
        "url": "https://corbettreport.com/mlk/"
      },
      {
        "title": "The WWI Conspiracy",
        "url": "https://corbettreport.com/wwi/"
      }
    ]
  },
  {
    "id": "humor",
    "title": "Humor",
    "image": humorImage,
    "links": [
      {
        "title": "5 Stupid Ideas You Won’t Believe the Government Actually Thought Of",
        "url": "https://corbettreport.com/?p=15950"
      },
      {
        "title": "9/11: A Conspiracy Theory",
        "url": "https://corbettreport.com/911-a-conspiracy-theory/"
      },
      {
        "title": "Dear Government, Deliver Us From Freedom",
        "url": "https://corbettreport.com/dear-government-deliver-us-from-freedom/"
      },
      {
        "title": "How to Herd Your Tax Cattle",
        "url": "https://corbettreport.com/episode-296-how-to-herd-your-tax-cattle/"
      },
      {
        "title": "How To Free Your Tax Cattle",
        "url": "https://corbettreport.com/episode-302-how-to-free-your-tax-cattle/"
      },
      {
        "title": "JFK: A Conspiracy Theory",
        "url": "https://corbettreport.com/jfk-a-conspiracy-theory/"
      },
      {
        "title": "OKC: A Conspiracy Theory",
        "url": "https://corbettreport.com/okc-a-conspiracy-theory/"
      },
      {
        "title": "Russiagate: A Conspiracy Theory",
        "url": "https://corbettreport.com/russiagate/"
      },
      {
        "title": "Sh*t Government Says",
        "url": "https://corbettreport.com/sht-government-says/"
      }
    ]
  },
  {
    "id": "literature",
    "title": "Literature",
    "image": literatureImage,
    "links": [
      {
        "title": "Aesop’s Fables",
        "url": "https://corbettreport.com/aesops-fables-flnwo-42/"
      },
      {
        "title": "“And Then There Were None…”",
        "url": "https://corbettreport.com/flnwo41/"
      },
      {
        "title": "James Corbett and Liberty Weekly Recommend Books",
        "url": "https://corbettreport.com/interview-1429-james-corbett-and-liberty-weekly-recommend-books/"
      },
      {
        "title": "The Anarchy of Language",
        "url": "https://corbettreport.com/the-anarchy-of-language/"
      },
      {
        "title": "Franz Kafka’s The Trial",
        "url": "https://corbettreport.com/?p=1604"
      },
      {
        "title": "Language is a Weapon",
        "url": "https://corbettreport.com/episode-357-language-is-a-weapon/"
      },
      {
        "title": "“The Library of Babel” by Jorge Luis Borges",
        "url": "https://corbettreport.com/the-library-of-babel-flnwo-27/"
      },
      {
        "title": "Narcissus and Goldmund",
        "url": "https://corbettreport.com/narcissus-and-goldmund-flnwo-24/"
      },
      {
        "title": "Newspeak is Doubleplusungood",
        "url": "https://corbettreport.com/episode-114-newspeak-is-doubleplusungood/"
      }
    ]
  },
  {
    "id": "media",
    "title": "Media",
    "image": mediaImage,
    "links": [
      {
        "title": "The Annual Fake News Awards",
        "url": "https://corbettreport.com/?s=fake+news+awards"
      },
      {
        "title": "A Brief History of Fake News",
        "url": "https://corbettreport.com/a-brief-history-of-fake-news/"
      },
      {
        "title": "Mass Media: A History",
        "url": "https://corbettreport.com/massmedia/"
      },
      {
        "title": "The Media Matrix",
        "url": "https://corbettreport.com/media/"
      },
      {
        "title": "The Myth of Journalistic Objectivity",
        "url": "https://corbettreport.com/episode-265-the-myth-of-journalistic-objectivity/"
      },
      {
        "title": "The Net Is Mightier Than The Sword – James Corbett at TEDxGroningen",
        "url": "https://corbettreport.com/the-net-is-mightier-than-the-sword-james-corbett-at-tedxgroningen/"
      },
      {
        "title": "No, the Dinosaur Journos Have NOT “Dropped Objectivity”",
        "url": "https://corbettreport.com/no-the-dinosaur-journos-have-not-dropped-objectivity/"
      },
      {
        "title": "Open Source Journalism",
        "url": "https://corbettreport.com/episode-288-open-source-journalism/"
      },
      {
        "title": "“The News” is a Social Construct. It is Used to Program You.",
        "url": "https://corbettreport.com/the-news-is-a-social-construct-it-is-used-to-program-you/"
      },
      {
        "title": "What is the alternative media?",
        "url": "https://corbettreport.com/what-is-the-alternative-media/"
      }
    ]
  },
  {
    "id": "politics",
    "title": "Politics",
    "image": politicsImage,
    "links": [
      {
        "title": "A Brief History of Hopium",
        "url": "https://corbettreport.com/hopium/"
      },
      {
        "title": "Crosswalk Buttons, Voting Booths, and other Illusions of Control",
        "url": "https://corbettreport.com/crosswalk-buttons-voting-booths-and-other-illusions-of-control/"
      },
      {
        "title": "How To REALLY Defeat Globalism",
        "url": "https://corbettreport.com/how-to-really-defeat-globalism/"
      },
      {
        "title": "James Corbett Discusses the Anarchist Ideologies",
        "url": "https://corbettreport.com/interview-884-james-corbett-discusses-the-anarchist-ideologies/"
      },
      {
        "title": "Larken Rose on the Immorality of Voting",
        "url": "https://corbettreport.com/interview-1225-larken-rose-on-the-immorality-of-voting/"
      },
      {
        "title": "The Last Word on Voting",
        "url": "https://corbettreport.com/the-last-word-on-voting/"
      },
      {
        "title": "The Law of Rule",
        "url": "https://corbettreport.com/the-law-of-rule/"
      },
      {
        "title": "Our Leaders Are Psychopaths",
        "url": "https://corbettreport.com/episode-090-our-leaders-are-psychopaths/"
      },
      {
        "title": "Tjeerd Andringa Exposes the Kakistocracy",
        "url": "https://corbettreport.com/interview-1024-tjeerd-andringa-exposes-the-kakistocracy/"
      }
    ]
  },
  {
    "id": "qanda",
    "title": "Q&A",
    "image": qaImage,
    "links": [
      {
        "title": "Are There Limits to Growth?",
        "url": "https://corbettreport.com/limitstogrowth/"
      },
      {
        "title": "How Can A Global Conspiracy Work?",
        "url": "https://corbettreport.com/how-can-a-global-conspiracy-work-questions-for-corbett-074/"
      },
      {
        "title": "How Will WWIII Be Fought?",
        "url": "https://corbettreport.com/how-will-wwiii-be-fought-questions-for-corbett-062/"
      },
      {
        "title": "Is the IPCC Rigged?",
        "url": "https://corbettreport.com/qfc-ipcc/"
      },
      {
        "title": "Mass Media Q&A",
        "url": "https://corbettreport.com/mediaqanda/"
      },
      {
        "title": "What is Technocracy?",
        "url": "https://corbettreport.com/qfc-technocracy/"
      }
    ]
  },
  {
    "id": "book-reviews",
    "title": "Book Reviews",
    "image": bookReviewsImage,
    "links": [
      {
        "title": "I Read Bill Gates’ New Book (So You Don’t Have To!)",
        "url": "https://corbettreport.com/gatesbook/"
      },
      {
        "title": "I Read The Great Narrative (So You Don’t Have To!)",
        "url": "https://corbettreport.com/greatnarrative/"
      },
      {
        "title": "I Read Richard Haass’ New Book (So You Don’t Have To!)",
        "url": "https://corbettreport.com/haass/"
      },
      {
        "title": "James Corbett and Liberty Weekly recommend books",
        "url": "https://corbettreport.com/interview-1429-james-corbett-and-liberty-weekly-recommend-books/"
      },
      {
        "title": "James Corbett gives a tour of his bookshelf",
        "url": "https://corbettreport.com/whats-on-your-bookshelf-questions-for-corbett-035/"
      },
      {
        "title": "A New World Order reading list",
        "url": "https://corbettreport.com/a-new-world-order-reading-list/"
      },
      {
        "title": "A WWI reading list",
        "url": "https://corbettreport.com/qfc042/"
      },
      {
        "title": "Another 25 Books You Should Read",
        "url": "https://corbettreport.com/another-25-books-you-should-read/"
      },
      {
        "title": "Another Another 25 Books You Should Read",
        "url": "https://corbettreport.com/another-another-25-books-you-should-read/"
      },
      {
        "title": "Summer 2021 Reading List",
        "url": "https://corbettreport.com/your-summer-reading-list/"
      },
      {
        "title": "A Mass Media Reading List",
        "url": "https://corbettreport.com/mediareading/"
      }
    ]
  },
  {
    "id": "red-pill-series",
    "title": "Red Pill Series",
    "image": redPillSeriesImage,
    "links": [
      {
        "title": "James Corbett Dispenses White Pills on AM WakeUp",
        "url": "https://corbettreport.com/whitepills/"
      },
      {
        "title": "James Corbett Explains the Great Reset for Conspiracy Beginners",
        "url": "https://corbettreport.com/interview-1600-james-corbett-explains-the-great-reset-on-the-highwire/"
      },
      {
        "title": "James Corbett Redpills the Croatians",
        "url": "https://corbettreport.com/interview-1792-james-corbett-redpills-the-croatians-on-cbdc/"
      },
      {
        "title": "James Corbett Redpills the Dutch",
        "url": "https://corbettreport.com/interview-1711-james-corbett-redpills-the-dutch/"
      },
      {
        "title": "James Corbett Redpills the Italians",
        "url": "https://corbettreport.com/interview-1709-james-corbett-redpills-the-italians/"
      },
      {
        "title": "James Corbett Redpills the Norwegians",
        "url": "https://corbettreport.com/interview-1697-james-corbett-redpills-the-norwegians-on-the-global-conspiracy/"
      },
      {
        "title": "James Corbett Redpills the Permaculture Crowd",
        "url": "https://corbettreport.com/interview-1638-james-corbett-redpills-the-permaculture-crowd/"
      },
      {
        "title": "James Corbett on Holding The Line",
        "url": "https://corbettreport.com/interview-1706-james-corbett-on-holding-the-line/"
      },
      {
        "title": "James Corbett to VCC: The Power is Ours!",
        "url": "https://corbettreport.com/interview-1696-james-corbett-to-vcc-the-power-is-ours/"
      }
    ]
  },
  {
    "id": "requiem-series",
    "title": "Requiem Series",
    "image": requiemSeriesImage,
    "links": [
      {
        "title": "Danny Casolaro",
        "url": "https://corbettreport.com/episode-209-requiem-for-the-suicided-danny-casolaro/"
      },
      {
        "title": "The DC Madam",
        "url": "https://corbettreport.com/episode-158-requiem-for-the-suicided-the-dc-madam/"
      },
      {
        "title": "Vince Foster",
        "url": "https://corbettreport.com/episode-247-requiem-for-the-suicided-vince-foster/"
      },
      {
        "title": "Kenneth Trentadue",
        "url": "https://corbettreport.com/episode182-kenneth-trentadue/"
      },
      {
        "title": "Gary Webb",
        "url": "https://corbettreport.com/episode-117-requiem-for-the-suicided-gary-webb/"
      },
      {
        "title": "Terrance Yeakey",
        "url": "https://corbettreport.com/episode-140-requiem-for-the-suicided-terrance-yeakey/"
      }
    ]
  },
  {
    "id": "science",
    "title": "Science",
    "image": scienceImage,
    "links": [
      {
        "title": "Climate Models for the Layman",
        "url": "https://corbettreport.com/interview-1261-judith-curry-explains-climate-modeling-to-the-layman/"
      },
      {
        "title": "The Crisis of Science",
        "url": "https://corbettreport.com/sciencecrisis/"
      },
      {
        "title": "Meet Paul Ehrlich, Pseudoscience Charlatan",
        "url": "https://corbettreport.com/ehrlich/"
      },
      {
        "title": "Patrick Wood Exposes the Technocracy Agenda",
        "url": "https://corbettreport.com/interview-1046-patrick-wood-exposes-the-technocracy-agenda/"
      },
      {
        "title": "The REAL Anthony Fauci with Robert F. Kennedy, Jr.",
        "url": "https://corbettreport.com/fauci/"
      },
      {
        "title": "Science Says",
        "url": "https://corbettreport.com/sciencesays/"
      },
      {
        "title": "The Weaponization of “Science”",
        "url": "https://corbettreport.com/the-weaponization-of-science/"
      },
      {
        "title": "What is the Average Global Temperature?",
        "url": "https://corbettreport.com/what-is-the-average-global-temperature/"
      }
    ]
  },
  {
    "id": "solutions",
    "title": "Solutions",
    "image": solutionsImage,
    "links": [
      {
        "title": "Autodidacticism",
        "url": "https://corbettreport.com/autodidacticism/"
      },
      {
        "title": "Buycotts",
        "url": "https://corbettreport.com/buycotts-solutionswatch/"
      },
      {
        "title": "The Bystander Effect",
        "url": "https://corbettreport.com/solutionswatch-bystander/"
      },
      {
        "title": "Choosing Chickens",
        "url": "https://corbettreport.com/choosing-chickens-solutionswatch/"
      },
      {
        "title": "How to Access the Library of Alexandria",
        "url": "https://corbettreport.com/how-to-access-the-library-of-alexandria-solutionswatch/"
      },
      {
        "title": "How to Present Info for Visual Learners",
        "url": "https://corbettreport.com/how-to-present-info-for-visual-learners-solutionswatch/"
      },
      {
        "title": "How to Research Online",
        "url": "https://corbettreport.com/solutionswatch-research/"
      },
      {
        "title": "Go Forth and Multiply",
        "url": "https://corbettreport.com/solutionswatch-multiply/"
      },
      {
        "title": "Make Your Own Media",
        "url": "https://corbettreport.com/episode-283-solutions-make-your-own-media/"
      },
      {
        "title": "Really Simple Syndication",
        "url": "https://corbettreport.com/really-simple-syndication-solutionswatch/"
      },
      {
        "title": "Solutions: Guerilla Gardening",
        "url": "https://corbettreport.com/episode-299-solutions-guerrilla-gardening/"
      },
      {
        "title": "Solutions: Laughing at Tyrants",
        "url": "https://corbettreport.com/episode-306-solutions-laughing-at-tyrants/"
      },
      {
        "title": "Solutions: Open Science",
        "url": "https://corbettreport.com/openscience/"
      },
      {
        "title": "Solutions: The Peer-to-Peer Economy",
        "url": "https://corbettreport.com/episode-303-solutions-the-peer-to-peer-economy/"
      },
      {
        "title": "Solutions: Revolution of the Mind",
        "url": "https://corbettreport.com/solutions-revolution-of-the-mind/"
      },
      {
        "title": "Solutions: Agorism",
        "url": "https://corbettreport.com/episode-309-solutions-agorism/"
      },
      {
        "title": "The Thick Red Line",
        "url": "https://corbettreport.com/interview-1598-howard-lichtman-on-the-thick-red-line/"
      },
      {
        "title": "Voluntary Solutions to End the Fed",
        "url": "https://corbettreport.com/interview-928-james-corbett-discusses-voluntary-solutions-to-ending-the-fed/"
      },
      {
        "title": "Writing A New Narrative – #SolutionsWatch",
        "url": "https://corbettreport.com/solutionswatch-narrative/"
      }
    ]
  },
  {
    "id": "biographies",
    "title": "Biographies",
    "image": biographiesImage,
    "links": [
      {
        "title": "Meet Allen Dulles: Fascist Spymaster",
        "url": "https://corbettreport.com/episode-307-meet-allen-dulles-fascist-spymaster/"
      },
      {
        "title": "Meet Edward Bernays",
        "url": "https://corbettreport.com/episode-033-meet-edward-bernays/"
      },
      {
        "title": "Meet Henry Kissinger",
        "url": "https://corbettreport.com/episode-106-meet-henry-kissinger/"
      },
      {
        "title": "Meet King Charles, The Great Resetter",
        "url": "https://corbettreport.com/charles/"
      },
      {
        "title": "Meet Lee Harvey Oswald: Sheepdipped Patsy",
        "url": "https://corbettreport.com/episode-278-meet-lee-harvey-oswald-sheep-dipped-patsy/"
      },
      {
        "title": "Meet Maurice Strong: Globalist, Oiligarch, “Environmentalist”",
        "url": "https://corbettreport.com/meet-maurice-strong-globalist-oiligarch-environmentalist/"
      },
      {
        "title": "The Secret Life of Timothy McVeigh",
        "url": "https://corbettreport.com/episode-305-the-secret-life-of-timothy-mcveigh/"
      },
      {
        "title": "The Unauthorized Biography of David Rockefeller",
        "url": "https://corbettreport.com/rockefeller/"
      },
      {
        "title": "Who Is Bill Gates?",
        "url": "https://corbettreport.com/gates/"
      }
    ]
  }
];
